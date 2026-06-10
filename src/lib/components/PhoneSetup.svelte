<script lang="ts">
	import { phoneHost } from '$lib/phone/host.svelte';
	import QrCode from './QrCode.svelte';

	let copied = $state(false);

	const statusText = $derived(
		{
			idle: 'Not connected',
			starting: 'Starting…',
			waiting: 'Waiting for your phone…',
			connecting: 'Phone connecting…',
			connected: 'Phone connected — streaming',
			error: 'Connection error'
		}[phoneHost.state]
	);

	async function copy() {
		if (!phoneHost.info) return;
		try {
			await navigator.clipboard.writeText(phoneHost.info.phoneUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* ignore */
		}
	}
</script>

<div class="px-5 py-4">
	{#if phoneHost.state === 'idle'}
		<div class="flex items-center justify-between gap-4">
			<p class="text-[12px] text-faint">
				Use your phone's camera over your local Wi-Fi. Nothing leaves your network.
			</p>
			<button
				onclick={() => phoneHost.start()}
				class="shrink-0 rounded-lg bg-accent/90 px-3.5 py-2 text-[13px] font-medium text-black transition-colors hover:bg-accent"
			>
				Connect a phone
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
			<div class="shrink-0">
				{#if phoneHost.info}
					<QrCode text={phoneHost.info.phoneUrl} size={156} />
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="mb-1 flex items-center gap-2">
					<span
						class="inline-block h-1.5 w-1.5 rounded-full {phoneHost.state === 'connected'
							? 'bg-accent'
							: phoneHost.state === 'error'
								? 'bg-red-500'
								: 'bg-muted'}"
						style={phoneHost.state === 'waiting' || phoneHost.state === 'connecting'
							? 'animation: fb-pulse 1.4s ease-in-out infinite;'
							: ''}
					></span>
					<span class="text-[13px] text-text">{statusText}</span>
				</div>
				<p class="mb-2 text-[11px] text-faint">
					Scan the code, or open the link on your phone (same Wi-Fi). Accept the security warning —
					the certificate is self-signed because the connection stays on your network.
				</p>
				{#if phoneHost.info}
					<div class="flex items-center gap-2">
						<code class="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted">
							{phoneHost.info.phoneUrl}
						</code>
						<button onclick={copy} class="shrink-0 text-[11px] text-faint transition-colors hover:text-text">
							{copied ? 'Copied' : 'Copy'}
						</button>
					</div>
				{/if}
				{#if phoneHost.info}
					<details class="mt-3 rounded-lg border border-border bg-surface-2/40">
						<summary class="cursor-pointer px-3 py-2 text-[12px] text-muted select-none">
							Seeing a security warning? Remove it →
						</summary>
						<div class="flex gap-3 px-3 pb-3 pt-1">
							<div class="shrink-0">
								<QrCode text={phoneHost.info.caSetupUrl} size={108} />
							</div>
							<p class="text-[11px] text-faint">
								<span class="mb-1 block text-[12px] text-text">One-time certificate install</span>
								Scan this (or open it on your phone) and follow the steps to install the certificate.
								After that the camera page is fully trusted — no warning. This download page is plain
								HTTP, so it won't warn.
							</p>
						</div>
					</details>
				{/if}
				{#if phoneHost.error}
					<p class="mt-1 text-[11px] text-red-400/90">{phoneHost.error}</p>
				{/if}
				<div class="mt-3 flex gap-2">
					{#if phoneHost.state === 'connected'}
						<button
							onclick={() => phoneHost.flipCamera()}
							class="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text"
						>
							Flip camera
						</button>
					{/if}
					<button
						onclick={() => phoneHost.stop()}
						class="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-text"
					>
						Disconnect
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
