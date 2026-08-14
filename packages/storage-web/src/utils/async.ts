/**
 * 把一个同步计算包装成已解决的 Promise。同步后端的异步方法一律用它， 保证除一次微任务外不引入额外开销，且异常路径与原生 async 函数一致 （抛出会变成 rejected
 * promise，而不是同步抛出）。
 */
export const toPromise = <T>(run: () => T): Promise<T> => {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error);
  }
};
