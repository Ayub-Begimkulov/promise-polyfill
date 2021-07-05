enum States {
  PENDING = "PENDING",
  RESOLVED = "RESOLVED",
  REJECTED = "REJECTED",
}

type UnaryFunction = (val?: any) => any;

export class MyPromise<T> {
  private state = States.PENDING;
  private value: unknown = null;
  private thenCallbacks: [
    UnaryFunction | undefined,
    UnaryFunction | undefined,
    UnaryFunction,
    UnaryFunction
  ][] = [];

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void
    ) => void
  ) {
    try {
      executor(
        value => {
          this.resolve(value);
        },
        reason => {
          this.reject(reason);
        }
      );
    } catch (e) {
      this.reject(e);
    }
  }

  static resolve<T>(value: T | PromiseLike<T>) {
    return new MyPromise<T>(resolve => resolve(value));
  }

  static reject<T = never>(reason?: any) {
    return new MyPromise<T>((_resolve, reject) => reject(reason));
  }

  static all<T>(promises: (T | PromiseLike<T>)[]): MyPromise<T[]> {
    const length = promises.length;
    const results: T[] = Array(length);
    let promisesResolved = 0;

    return new MyPromise<T[]>((resolve, reject) => {
      promises.forEach((promise, index) => {
        MyPromise.resolve(promise).then(val => {
          promisesResolved++;
          results[index] = val;
          if (promisesResolved === length) {
            resolve(results);
          }
        }, reject);
      });
    });
  }

  static allSettled<T>(
    promises: (T | PromiseLike<T>)[]
  ): MyPromise<PromiseSettledResult<T>[]> {
    const length = promises.length;
    const results: PromiseSettledResult<T>[] = Array(length);
    let promisesResolved = 0;

    return new MyPromise(resolve => {
      const resolver = (value: PromiseSettledResult<T>, index: number) => {
        promisesResolved++;
        results[index] = value;
        if (promisesResolved === length) {
          resolve(results);
        }
      };
      promises.forEach((promise, index) => {
        MyPromise.resolve(promise).then(
          value => resolver({ status: "fulfilled", value }, index),
          reason => resolver({ status: "rejected", reason }, index)
        );
      });
    });
  }

  static race<T>(promises: (T | PromiseLike<T>)[]): MyPromise<T> {
    return new MyPromise((resolve, reject) => {
      promises.forEach(promise => {
        MyPromise.resolve(promise).then(resolve, reject);
      });
    });
  }

  then<R>(
    onResolve?: (value: T) => R | PromiseLike<R>,
    onReject?: (reason?: any) => void
  ) {
    return new MyPromise<R>((resolve, reject) => {
      // notice that we store both passed by user callback
      // and resolve function from new instance
      this.thenCallbacks.push([onResolve, onReject, resolve, reject]);
      // will call then callbacks in case if
      // promise already has value
      this.runThenCallbacks();
    });
  }

  catch(onReject?: (reason?: any) => void) {
    return this.then(undefined, onReject);
  }

  // private method
  // don't confuse it with static Promise.resolve method
  private resolve(value: T | PromiseLike<T>) {
    if (this.state !== States.PENDING) return;
    if (isPromiseLike(value)) {
      try {
        value.then(
          val => {
            this.resolve(val);
          },
          e => {
            this.reject(e);
          }
        );
      } catch (e) {
        this.reject(e);
      }
    } else {
      this.value = value;
      this.state = States.RESOLVED;
      this.runThenCallbacks();
    }
  }

  private reject(reason?: any) {
    if (this.state !== States.PENDING) return;
    this.value = reason;
    this.state = States.REJECTED;
    this.runThenCallbacks();
  }

  private runThenCallbacks() {
    if (this.state === States.PENDING) return;
    asap(() => {
      const { state, value, thenCallbacks } = this;

      while (thenCallbacks.length) {
        const [onResolveCb, onRejectCb, resolve, reject] =
          thenCallbacks.shift()!;
        try {
          if (state === States.RESOLVED) {
            // onResolveCb may be undefined
            if (onResolveCb) {
              resolve(onResolveCb(value));
            } else {
              resolve(value);
            }
          } else {
            // onRejectCb may be undefined
            if (onRejectCb) {
              // if we have onRejectCb then we
              // will resolve promise with it's result
              resolve(onRejectCb(value));
            } else {
              reject(value);
            }
          }
        } catch (e) {
          reject(e);
        }
      }
    });
  }
}

const asap = makeAsap();

function makeAsap() {
  if (typeof window.MutationObserver === "function") {
    const el = document.createElement("div");
    let currentCallback: (() => void) | null = null;
    const observer = new MutationObserver(() => {
      if (isFunction(currentCallback)) {
        currentCallback();
        currentCallback = null;
      }
    });
    observer.observe(el, { attributes: true });
    return function (cb: () => void) {
      currentCallback = cb;
      el.dataset.test = Math.random().toString();
    };
  } else if (process && isFunction(process.nextTick)) {
    return process.nextTick;
  } else {
    return function (cb: () => void) {
      setTimeout(() => cb(), 0);
    };
  }
}

function isFunction(val: unknown): val is (...args: any[]) => any {
  return typeof val === "function";
}

function isObject(val: unknown): val is Record<string, any> {
  return typeof val === "function" && val !== null;
}

function isPromiseLike(val: unknown): val is PromiseLike<any> {
  return isObject(val) && isFunction(val.then);
}
