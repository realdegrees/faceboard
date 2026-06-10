<script lang="ts">
	import QRCode from 'qrcode';

	let { text, size = 180 }: { text: string; size?: number } = $props();

	let src = $state('');

	// toDataURL is async so it can't be a $derived; regenerate when text changes.
	$effect(() => {
		const value = text;
		QRCode.toDataURL(value, {
			margin: 1,
			width: size,
			color: { dark: '#0a0a0bff', light: '#ededf0ff' }
		})
			.then((url) => (src = url))
			.catch(() => (src = ''));
	});
</script>

{#if src}
	<img {src} alt="Pairing QR code" width={size} height={size} class="rounded-md" />
{:else}
	<div class="grid place-items-center rounded-md bg-surface-2" style="width:{size}px;height:{size}px">
		<span class="text-[11px] text-faint">…</span>
	</div>
{/if}
