/**
 * @author Kuitos
 * @since 2020-05-15
 */

import type { FrameworkLifeCycles } from '../interfaces';

// 引擎自带的声明周期函数每次挂载都会执行
export default function getAddOn(global: Window): FrameworkLifeCycles<any> {
  return {
    async beforeLoad() {
      // eslint-disable-next-line no-param-reassign
      global.__POWERED_BY_QIANKUN__ = true;
    },

    async beforeMount() {
      // eslint-disable-next-line no-param-reassign
      global.__POWERED_BY_QIANKUN__ = true;
    },

    async beforeUnmount() {
      // eslint-disable-next-line no-param-reassign
      delete global.__POWERED_BY_QIANKUN__;
    },
  };
}
