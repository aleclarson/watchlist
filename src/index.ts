import { promisify } from 'util';
import { resolve, join } from 'path';
import { existsSync, readdir, stat, watch as fsw, Stats, FSWatcher } from 'fs';

const toStats = promisify(stat);
const toRead = promisify(readdir);

// Type definitions based on index.d.ts
type Arrayable<T> = T[] | T;
type Promisable<T> = Promise<T> | T;

export interface Options {
	cwd?: string;
	clear?: boolean;
	ignore?: Arrayable<RegExp | string>;
	eager?: boolean;
}

export type Handler = () => Promisable<any>;

// Callback type for the walk function
type WalkCallback = (rel: string, abs: string, stats: Stats) => void;

// onChange type for the setup function based on fs.watch usage
type OnChangeCallback = (dir: string, eventType: string, filename: string | null) => void;


// modified: lukeed/totalist
async function walk(dir: string, callback: WalkCallback, pre: string = ''): Promise<void> {
	await toRead(dir).then(arr => {
		return Promise.all(
			arr.map(async (str) => {
				const abs = join(dir, str);
				try {
					const stats = await toStats(abs);
					if (stats.isDirectory()) {
						callback(join(pre, str), abs, stats);
						await walk(abs, callback, join(pre, str));
					}
					// If it's not a directory, we don't need to do anything based on original logic
				} catch (err) {
					// Handle potential errors during stat, e.g., permission issues
					console.error(`Error processing ${abs}:`, err);
				}
			})
		);
	});
}

async function setup(dir: string, onChange: OnChangeCallback): Promise<Record<string, FSWatcher>> {
	const output: Record<string, FSWatcher> = {};

	try {
		// recursive: true is preferred but might not be available
		output[dir] = fsw(dir, { recursive: true }, (eventType, filename) => onChange(dir, eventType, filename ? String(filename) : null));
	} catch (err: any) {
		if (err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err;
		// Fallback for platforms without recursive watch
		console.warn(`Recursive watch not supported on this platform for "${dir}". Falling back to non-recursive watch.`);
		output[dir] = fsw(dir, (eventType, filename) => onChange(dir, eventType, filename ? String(filename) : null));
		await walk(dir, (rel, abs) => {
			// Watch each subdirectory individually
			if (!output[abs]) { // Avoid duplicate watchers if walk finds the starting dir
				output[abs] = fsw(abs, (eventType, filename) => onChange(abs, eventType, filename ? String(filename) : null));
			}
		});
	}

	return output;
}

export async function watch(list: string[], callback: Handler, opts: Options = {}): Promise<void> {
	const cwd = resolve('.', opts.cwd || '.');
	// Ensure directories exist before watching
	const dirs = new Set(
		list
			.map(str => resolve(cwd, str))
			.filter(absPath => {
				const exists = existsSync(absPath);
				if (!exists) {
					console.warn(`Directory "${absPath}" not found. Skipping.`);
				}
				return exists;
			})
	);

	// Ensure opts.ignore is always an array and handle string/RegExp conversion
	const ignorePatterns = Array.isArray(opts.ignore) ? opts.ignore : (opts.ignore ? [opts.ignore] : []);
	const ignores: RegExp[] = ['node_modules', ...ignorePatterns]
		.map(pattern => typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern);


	let wip = 0;
	let delay: NodeJS.Timeout | null = null;
	const Watchers = new Map<string, FSWatcher>();

	async function handle(): Promise<void> {
		wip = 1; // Mark as work-in-progress
		try {
			await callback();
		} catch (error) {
			console.error('Error during watched task execution:', error);
		} finally {
			wip--; // Decrement wip *after* potential async callback finishes
			if (wip > 0) {
				// If onChange triggered again while handle() was running, wip would be > 0
				wip = 0; // Reset wip
				handle(); // Rerun immediately
			}
		}
	}

	// TODO: Catch `EPERM` on Windows for removed dir
	async function onChange(dir: string, type: string, filename: string | null): Promise<void> {
		// Basic filtering
		if (!filename || ignores.some(x => x.test(filename))) {
			return;
		}

		// Debounce logic
		if (delay) clearTimeout(delay);

		delay = setTimeout(() => {
			delay = null; // Clear the timeout ID
			if (wip > 0) {
				wip++; // Increment wip to signal a pending run after the current one finishes
				return;
			}
			if (opts.clear) console.clear();
			handle();
		}, 100); // 100ms debounce window
	}

	// Close existing watchers before setting up new ones (important for re-runs or dynamic updates if added later)
	Watchers.forEach(watcher => watcher.close());
	Watchers.clear();

	for (const dir of dirs) {
		try {
			const output = await setup(dir, onChange);
			for (const key in output) {
				if (!Watchers.has(key)) { // Avoid overwriting watchers if setup returns duplicates
					Watchers.set(key, output[key]);
				}
			}
		} catch (err) {
			console.error(`Failed to set up watch for directory "${dir}":`, err);
		}
	}

	// Initial run if eager is set
	if (opts.eager) {
		await handle();
	}

	// Note: This function implicitly returns Promise<void>
	// Consider adding explicit cleanup logic (e.g., a function to close all watchers) if needed
}
