import { promisify } from 'util';
import { resolve, join } from 'path';
import { existsSync, readdir, stat, watch as fsw } from 'fs';

const toStats = promisify(stat);
const toRead = promisify(readdir);

// modified: lukeed/totalist
async function walk(dir, callback, pre='') {
	await toRead(dir).then(arr => {
		return Promise.all(
			arr.map(str => {
				let abs = join(dir, str);
				return toStats(abs).then(stats => {
					if (!stats.isDirectory()) return;
					callback(join(pre, str), abs, stats);
					return walk(abs, callback, join(pre, str));
				});
			})
		);
	});
}

async function setup(dir, onChange) {
	let output = {};

	try {
		output[dir] = fsw(dir, { recursive: true }, onChange.bind(0, dir));
	} catch (err) {
		if (err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err;
		output[dir] = fsw(dir, onChange.bind(0, dir));
		await walk(dir, (rel, abs) => {
			output[abs] = fsw(abs, onChange.bind(0, abs));
		});
	}

	return output;
}

export async function watch(list, callback, opts={}) {
	const cwd = resolve('.', opts.cwd || '.');
	const dirs = new Set(list.map(str => resolve(cwd, str)).filter(existsSync));
	const ignores = ['node_modules'].concat(opts.ignore || []).map(x => new RegExp(x, 'i'));

	let wip = 0;
	let delay = 0;
	const Watchers = new Map;

	async function handle() {
		wip = 1;
		try {
			await callback();
		} catch (error) {
			console.error(error);
		}
		if (--wip) handle();
	}

	// TODO: Catch `EPERM` on Windows for removed dir
	async function onChange(dir, type, filename) {
		if (wip > 1 || ignores.some(x => x.test(filename))) return;

		clearTimeout(delay);
		delay = setTimeout(() => {
			if (wip++) return;
			if (opts.clear) console.clear();
			handle();
		}, 100);
	}

	let dir, output, key;
	for (dir of dirs) {
		output = await setup(dir, onChange);
		for (key in output) Watchers.set(key, output[key]);
	}

	if (opts.eager) {
		await handle();
	}
}
