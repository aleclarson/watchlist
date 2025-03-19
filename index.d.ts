type Arrayable<T> = T[] | T;
type Promisable<T> = Promise<T> | T;

export interface Options {
	cwd: string;
	clear: boolean;
	ignore: Arrayable<RegExp | string>;
	eager: boolean;
}

export type Handler = () => Promisable<any>;

export function watch(dirs: string[], handler: Handler, opts?: Partial<Options>): Promise<void>;
