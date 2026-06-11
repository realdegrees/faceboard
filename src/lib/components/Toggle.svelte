<script lang="ts">
	let {
		checked = false,
		onChange,
		label = 'Toggle',
		disabled = false
	}: { checked?: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean } =
		$props();
</script>

<button
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	onclick={() => onChange(!checked)}
	class="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 {checked
		? 'bg-accent/80'
		: 'bg-surface-3'}"
>
	<span
		class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform {checked
			? 'translate-x-4'
			: ''}"
	></span>
</button>
