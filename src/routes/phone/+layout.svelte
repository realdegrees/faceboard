<script lang="ts">
	// Bare layout for the phone-as-webcam page — no desktop chrome. This route is
	// what a phone loads over the LAN to stream its camera to the desktop app.
	let { children } = $props();
</script>

<div class="min-h-screen w-full bg-bg text-text">
	{@render children()}
</div>

<!-- The desktop shell locks `body { overflow: hidden }`; the phone page is a real
     mobile web page and must scroll to reach the controls below the preview. -->
<style>
	:global(html),
	:global(body) {
		height: auto;
		min-height: 100%;
		overflow-y: auto;
	}
</style>
