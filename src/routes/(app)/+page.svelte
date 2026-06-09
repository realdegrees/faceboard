<script lang="ts">
	// Dashboard — live camera preview, detection status and recent triggers land
	// here in later milestones.
</script>

<section class="mx-auto max-w-5xl px-8 py-7">
	<header class="mb-6">
		<h1 class="text-[19px] font-semibold tracking-tight">Dashboard</h1>
		<p class="mt-1 text-[13px] text-muted">Live camera, detection status and recent triggers.</p>
	</header>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<div class="lg:col-span-2 rounded-card border border-border bg-surface-1 p-4">
			<div
				class="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-border-strong bg-surface-2 text-[13px] text-faint"
			>
				Camera preview
			</div>
		</div>
		<div class="rounded-card border border-border bg-surface-1 p-4">
			<h2 class="text-[13px] font-medium text-muted">Status</h2>
			<p class="mt-3 text-[13px] text-faint">Detection is idle.</p>
		</div>
	</div>
</section>
