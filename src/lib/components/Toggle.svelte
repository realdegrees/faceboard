<script lang="ts">
	let {
		checked = false,
		onChange,
		label = 'Toggle'
	}: { checked?: boolean; onChange: (v: boolean) => void; label?: string } = $props();
</script>

<button
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={() => onChange(!checked)}
	class="relative h-5 w-9 shrink-0 rounded-full transition-colors {checked
		? 'bg-accent/80'
		: 'bg-surface-3'}"
>
	<span
		class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform {checked
			? 'translate-x-4'
			: ''}"
	></span>
</button>
