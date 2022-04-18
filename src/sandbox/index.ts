/**
 * @author Kuitos
 * @since 2019-04-11
 */
import type { Freer, Rebuilder, SandBox } from '../interfaces';
import LegacySandbox from './legacy/sandbox';
import { patchAtBootstrapping, patchAtMounting } from './patchers';
import ProxySandbox from './proxySandbox';
import SnapshotSandbox from './snapshotSandbox';

export { css } from './patchers';
export { getCurrentRunningApp } from './common';

/**
 * 生成应用运行时沙箱
 *
 * 沙箱分两个类型：
 * 1. app 环境沙箱
 *  app 环境沙箱是指应用初始化过之后，应用会在什么样的上下文环境运行。每个应用的环境沙箱只会初始化一次，因为子应用只会触发一次 bootstrap 。
 *  子应用在切换时，实际上切换的是 app 环境沙箱。
 * 2. render 沙箱
 *  子应用在 app mount 开始前生成好的的沙箱。每次子应用切换过后，render 沙箱都会重现初始化。
 *
 * 这么设计的目的是为了保证每个子应用切换回来之后，还能运行在应用 bootstrap 之后的环境下。
 *
 * @param appName
 * @param elementGetter
 * @param scopedCSS
 * @param useLooseSandbox
 * @param excludeAssetFilter
 * @param globalContext
 */
export function createSandboxContainer(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  scopedCSS: boolean,
  useLooseSandbox?: boolean,
  excludeAssetFilter?: (url: string) => boolean,
  globalContext?: typeof window,
) {
  let sandbox: SandBox;
  // js 沙箱
  if (window.Proxy) {
    sandbox = useLooseSandbox ? new LegacySandbox(appName, globalContext) : new ProxySandbox(appName, globalContext);
  } else {
    sandbox = new SnapshotSandbox(appName);
  }

  // some side effect could be be invoked while bootstrapping,
  // such as dynamic stylesheet injection with style-loader, especially during the development phase
  /**
   * 样式沙箱
   *
   * 增强多例模式下的 createElement 方法，负责创建元素并劫持 script、link、style 三个标签的创建动作
   * 增强 appendChild、insertBefore 方法，负责添加元素，并劫持 script、link、style 三个标签的添加动作，做一些特殊的处理 =>
   * 根据是否是主应用调用决定标签是插入到主应用还是微应用，并且将 proxy 对象传递给微应用，作为其全局对象，以达到 JS 隔离的目的
   * 初始化完成后返回 free 函数，会在微应用卸载时被调用，负责清除 patch、缓存动态添加的样式（因为微应用被卸载后所有的相关DOM元素都会被删掉）
   * free 函数执行完成后返回 rebuild 函数，在微应用重新挂载时会被调用，负责向微应用添加刚才缓存的动态样式
   *
   * 其实严格来说这个样式沙箱有点名不副实，真正的样式隔离是之前说的 严格样式隔离模式 和 scoped css模式 提供的，当然如果开启了 scoped css，
   * 样式沙箱中动态添加的样式也会经过 scoped css 的处理；回到正题，样式沙箱实际做的事情其实很简单，将动态添加的 script、link、style
   * 这三个元素插入到对的位置，属于主应用的插入主应用，属于微应用的插入到对应的微应用中，方便微应用卸载的时候一起删除，
   * 当然样式沙箱还额外做了两件事：一、在卸载之前为动态添加样式做缓存，在微应用重新挂载时再插入到微应用内，二、将 proxy 对象传递给 execScripts
   * 函数，将其设置为微应用的执行上下文
   */
  // 样式沙箱
  const bootstrappingFreers = patchAtBootstrapping(appName, elementGetter, sandbox, scopedCSS, excludeAssetFilter);
  // mounting freers are one-off and should be re-init at every mounting time
  let mountingFreers: Freer[] = [];

  let sideEffectsRebuilders: Rebuilder[] = [];

  return {
    instance: sandbox,

    /**
     * 沙箱被 mount
     * 可能是从 bootstrap 状态进入的 mount
     * 也可能是从 unmount 之后再次唤醒进入 mount
     */
    async mount() {
      /* ------------------------------------------ 因为有上下文依赖（window），以下代码执行顺序不能变 ------------------------------------------ */

      /* ------------------------------------------ 1. 启动/恢复 沙箱------------------------------------------ */
      sandbox.active();

      const sideEffectsRebuildersAtBootstrapping = sideEffectsRebuilders.slice(0, bootstrappingFreers.length);
      const sideEffectsRebuildersAtMounting = sideEffectsRebuilders.slice(bootstrappingFreers.length);

      // must rebuild the side effects which added at bootstrapping firstly to recovery to nature state
      if (sideEffectsRebuildersAtBootstrapping.length) {
        // 微应用再次挂载时重建刚才缓存的动态样式
        sideEffectsRebuildersAtBootstrapping.forEach((rebuild) => rebuild());
      }

      /* ------------------------------------------ 2. 开启全局变量补丁 ------------------------------------------*/
      // render 沙箱启动时开始劫持各类全局监听，尽量不要在应用初始化阶段有 事件监听/定时器 等副作用
      mountingFreers = patchAtMounting(appName, elementGetter, sandbox, scopedCSS, excludeAssetFilter);

      /* ------------------------------------------ 3. 重置一些初始化时的副作用 ------------------------------------------*/
      // 存在 rebuilder 则表明有些副作用需要重建
      // 现在只看到针对 umi 的那个 patchHistoryListener 有 rebuild 操作
      if (sideEffectsRebuildersAtMounting.length) {
        sideEffectsRebuildersAtMounting.forEach((rebuild) => rebuild());
      }

      // clean up rebuilders 卸载时会再填充回来
      sideEffectsRebuilders = [];
    },

    /**
     * 恢复 global 状态，使其能回到应用加载之前的状态
     */
    async unmount() {
      // record the rebuilders of window side effects (event listeners or timers)
      // note that the frees of mounting phase are one-off as it will be re-init at next mounting
      sideEffectsRebuilders = [...bootstrappingFreers, ...mountingFreers].map((free) => free());

      sandbox.inactive();
    },
  };
}
