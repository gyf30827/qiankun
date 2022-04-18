/**
 * @author Kuitos
 * @since 2020-10-13
 */

import type { Freer } from '../../../interfaces';
import { nativeGlobal } from '../../../utils';
import { getCurrentRunningApp } from '../../common';
import type { ContainerConfig } from './common';
import {
  isHijackingTag,
  patchHTMLDynamicAppendPrototypeFunctions,
  rawHeadAppendChild,
  rebuildCSSRules,
  recordStyledComponentsCSSRules,
} from './common';

declare global {
  interface Window {
    __proxyAttachContainerConfigMap__: WeakMap<WindowProxy, ContainerConfig>;
  }
}

// Get native global window with a sandbox disgusted way, thus we could share it between qiankun instances🤪
Object.defineProperty(nativeGlobal, '__proxyAttachContainerConfigMap__', { enumerable: false, writable: true });

// Share proxyAttachContainerConfigMap between multiple qiankun instance, thus they could access the same record
nativeGlobal.__proxyAttachContainerConfigMap__ =
  nativeGlobal.__proxyAttachContainerConfigMap__ || new WeakMap<WindowProxy, ContainerConfig>();
const proxyAttachContainerConfigMap = nativeGlobal.__proxyAttachContainerConfigMap__;

const elementAttachContainerConfigMap = new WeakMap<HTMLElement, ContainerConfig>();

const docCreatePatchedMap = new WeakMap<typeof document.createElement, typeof document.createElement>();
// 增强 document.createElement
function patchDocumentCreateElement() {
  const docCreateElementFnBeforeOverwrite = docCreatePatchedMap.get(document.createElement);

  if (!docCreateElementFnBeforeOverwrite) {
    const rawDocumentCreateElement = document.createElement;
    Document.prototype.createElement = function createElement<K extends keyof HTMLElementTagNameMap>(
      this: Document,
      tagName: K,
      options?: ElementCreationOptions,
    ): HTMLElement {
      const element = rawDocumentCreateElement.call(this, tagName, options);
      if (isHijackingTag(tagName)) {
        const { window: currentRunningSandboxProxy } = getCurrentRunningApp() || {};
        if (currentRunningSandboxProxy) {
          const proxyContainerConfig = proxyAttachContainerConfigMap.get(currentRunningSandboxProxy);
          if (proxyContainerConfig) {
            elementAttachContainerConfigMap.set(element, proxyContainerConfig);
          }
        }
      }

      return element;
    };

    // It means it have been overwritten while createElement is an own property of document
    if (document.hasOwnProperty('createElement')) {
      document.createElement = Document.prototype.createElement;
    }

    docCreatePatchedMap.set(Document.prototype.createElement, rawDocumentCreateElement);
  }

  return function unpatch() {
    if (docCreateElementFnBeforeOverwrite) {
      Document.prototype.createElement = docCreateElementFnBeforeOverwrite;
      document.createElement = docCreateElementFnBeforeOverwrite;
    }
  };
}

let bootstrappingPatchCount = 0;
let mountingPatchCount = 0;

export function patchStrictSandbox(
  appName: string,
  appWrapperGetter: () => HTMLElement | ShadowRoot,
  proxy: Window,
  mounting = true,
  scopedCSS = false,
  excludeAssetFilter?: CallableFunction,
): Freer {
  let containerConfig = proxyAttachContainerConfigMap.get(proxy);
  if (!containerConfig) {
    containerConfig = {
      appName,
      proxy,
      appWrapperGetter,
      dynamicStyleSheetElements: [],
      strictGlobal: true,
      excludeAssetFilter,
      scopedCSS,
    };
    proxyAttachContainerConfigMap.set(proxy, containerConfig);
  }
  // 所有动态加载的样式都存储到 containerConfig 中（全局变量）
  // all dynamic style sheets are stored in proxy container
  const { dynamicStyleSheetElements } = containerConfig;
  // 增强 document.createElement 拦截 link style script 标签的创建
  // 并且将创建的标签存储在 elementAttachContainerConfigMap 中
  const unpatchDocumentCreate = patchDocumentCreateElement();
  // 增强 appendChild、insertBefore、removeChild 三个元素；除了本职工作之外，appendChild 和 insertBefore 还可以额外处理 script、style、link
  // 三个标签的插入，可以根据情况决定元素被插入到微应用模版空间中还是主应用模版空间，removeChild 也是可以根据情况移除主应用的元素还是移除微应用中这三个元素
  const unpatchDynamicAppendPrototypeFunctions = patchHTMLDynamicAppendPrototypeFunctions(
    (element) => elementAttachContainerConfigMap.has(element),
    (element) => elementAttachContainerConfigMap.get(element)!,
  );
  // 记录初始化的次数
  if (!mounting) bootstrappingPatchCount++;
  // 记录挂载的次数
  if (mounting) mountingPatchCount++;
  // 初始化完成后返回 free 函数，负责清除 patch、缓存动态添加的样式、返回 rebuild 函数，
  // rebuild 函数在微应用重新挂载时向微应用添加刚才缓存的动态样式
  return function free() {
    // bootstrap patch just called once but its freer will be called multiple times
    if (!mounting && bootstrappingPatchCount !== 0) bootstrappingPatchCount--;
    if (mounting) mountingPatchCount--;
    // 判断所有微应用是否都被卸载了
    const allMicroAppUnmounted = mountingPatchCount === 0 && bootstrappingPatchCount === 0;
    // 微应用都卸载以后移除 patch release the overwrite prototype after all the micro apps unmounted
    if (allMicroAppUnmounted) {
      unpatchDynamicAppendPrototypeFunctions();
      unpatchDocumentCreate();
    }
    // 记录了 样式表
    recordStyledComponentsCSSRules(dynamicStyleSheetElements);

    // As now the sub app content all wrapped with a special id container,
    // the dynamic style sheet would be removed automatically while unmoutting

    // 重新填入css样式
    return function rebuild() {
      rebuildCSSRules(dynamicStyleSheetElements, (stylesheetElement) => {
        const appWrapper = appWrapperGetter();
        if (!appWrapper.contains(stylesheetElement)) {
          rawHeadAppendChild.call(appWrapper, stylesheetElement);
          return true;
        }

        return false;
      });
    };
  };
}
