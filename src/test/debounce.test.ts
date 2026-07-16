import * as assert from 'assert';
import { KeyedDebouncer } from '../util/debounce.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('util/debounce KeyedDebouncer', () => {
	test('runs the callback once after the delay (happy path)', async () => {
		const d = new KeyedDebouncer(20);
		let calls = 0;
		d.schedule('a', () => calls++);
		assert.strictEqual(calls, 0, 'must not run synchronously');
		await delay(50);
		assert.strictEqual(calls, 1);
	});

	test('rapid rescheduling of the same key collapses to a single trailing run', async () => {
		const d = new KeyedDebouncer(30);
		const seen: number[] = [];
		d.schedule('a', () => seen.push(1));
		d.schedule('a', () => seen.push(2));
		d.schedule('a', () => seen.push(3));
		await delay(70);
		assert.deepStrictEqual(seen, [3], 'only the latest callback should fire, once');
	});

	test('different keys are debounced independently', async () => {
		const d = new KeyedDebouncer(20);
		const fired: string[] = [];
		d.schedule('a', () => fired.push('a'));
		d.schedule('b', () => fired.push('b'));
		await delay(50);
		assert.deepStrictEqual(fired.sort(), ['a', 'b']);
	});

	test('cancel() prevents a pending run for that key only', async () => {
		const d = new KeyedDebouncer(30);
		const fired: string[] = [];
		d.schedule('a', () => fired.push('a'));
		d.schedule('b', () => fired.push('b'));
		d.cancel('a');
		await delay(60);
		assert.deepStrictEqual(fired, ['b']);
	});

	test('cancel() on an unknown key is a no-op (no throw)', () => {
		const d = new KeyedDebouncer(10);
		assert.doesNotThrow(() => d.cancel('missing'));
	});

	test('dispose() cancels every pending run', async () => {
		const d = new KeyedDebouncer(30);
		let calls = 0;
		d.schedule('a', () => calls++);
		d.schedule('b', () => calls++);
		d.dispose();
		await delay(60);
		assert.strictEqual(calls, 0);
	});

	test('a key can be reused after it has fired', async () => {
		const d = new KeyedDebouncer(20);
		let calls = 0;
		d.schedule('a', () => calls++);
		await delay(40);
		d.schedule('a', () => calls++);
		await delay(40);
		assert.strictEqual(calls, 2);
	});
});
