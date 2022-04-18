/**
 * @author Kuitos
 * @since 2019-11-12
 */
import type { FrameworkLifeCycles } from '../interfaces';

const rawPublicPath = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;

// 运行时 声明周期，主要是为了在全局中添加 当前子应用 的 publicPath ， 主要是解决 微应用动态加载脚本和样式文件
export default function getAddOn(global: Window, publicPath = '/'): FrameworkLifeCycles<any> {
  let hasMountedOnce = false;

  return {
    async beforeLoad() {
      // eslint-disable-next-line no-param-reassign
      global.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ = publicPath;
    },

    async beforeMount() {
      if (hasMountedOnce) {
        // eslint-disable-next-line no-param-reassign
        global.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ = publicPath;
      }
    },

    async beforeUnmount() {
      if (rawPublicPath === undefined) {
        // eslint-disable-next-line no-param-reassign
        delete global.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
      } else {
        // eslint-disable-next-line no-param-reassign
        global.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ = rawPublicPath;
      }

      hasMountedOnce = true;
    },
  };
}
