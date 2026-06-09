/**
 * Move an element to `document.body` (or another target) for the duration of
 * its lifetime. Used for modals/overlays so `position: fixed` resolves against
 * the viewport rather than a transformed ancestor.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
	function mount(t: HTMLElement | string) {
		const el = typeof t === 'string' ? document.querySelector<HTMLElement>(t) : t;
		(el ?? document.body).appendChild(node);
	}
	mount(target);
	return {
		update: mount,
		destroy() {
			node.remove();
		}
	};
}
