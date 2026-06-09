<script lang="ts">
	// Bare layout for the phone-as-webcam page — no desktop chrome. This route is
	// what a phone loads over the LAN to stream its camera to the desktop app.
	let { children } = $props();
</script>

<div class="min-h-screen w-full bg-bg text-text">
	{@render children()}
</div>
