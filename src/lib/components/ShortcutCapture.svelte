<script lang="ts">
	import { getBridge } from '$lib/bridge';

	let { value, onChange }: { value: string | null; onChange: (a: string | null) => void } = $props();

	let listening = $state(false);
	const isMac = getBridge()?.platform === 'darwin';

	function mainKey(code: string): string | null {
		if (code.startsWith('Key')) return code.slice(3);
		if (code.startsWith('Digit')) return code.slice(5);
		if (/^F\d{1,2}$/.test(code)) return code;
		const map: Record<string, string> = {
			Space: 'Space', Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab',
			ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
			Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
			Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`'
		};
		return map[code] ?? null;
	}

	function toAccelerator(e: KeyboardEvent): string | null {
		const parts: string[] = [];
		if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
		if (e.altKey) parts.push('Alt');
		if (e.shiftKey) parts.push('Shift');
		const key = mainKey(e.code);
		if (!key) return null;
		parts.push(key);
		// Require at least one modifier so a bare key can't grab global focus.
		return parts.length >= 2 ? parts.join('+') : null;
	}

	function pretty(accel: string | null): string {
		if (!accel) return 'Not set';
		return accel
			.split('+')
			.map((p) => (p === 'CommandOrControl' ? (isMac ? 'Cmd' : 'Ctrl') : p))
			.join(' + ');
	}

	function onKey(e: KeyboardEvent) {
		if (!listening) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') {
			listening = false;
			return;
		}
		const accel = toAccelerator(e);
		if (accel) {
			onChange(accel);
			listening = false;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="flex items-center gap-2">
	<button
		onclick={() => (listening = !listening)}
		class="min-w-36 rounded-lg border px-3 py-1.5 text-center text-[12px] transition-colors {listening
			? 'border-accent/60 bg-accent/10 text-accent'
			: 'border-border bg-surface-2 text-text hover:border-border-strong'}"
	>
		{listening ? 'Press keys…' : pretty(value)}
	</button>
	{#if value && !listening}
		<button
			onclick={() => onChange(null)}
			class="text-[12px] text-faint transition-colors hover:text-muted"
		>
			Clear
		</button>
	{/if}
</div>
