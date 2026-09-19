export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXT_PHASE === "phase-production-build") return

  try {
    const { seedShippedAgentReleases } =
      await import("./lib/shipped-agent-releases")
    await seedShippedAgentReleases()
  } catch (error) {
    console.error("Could not publish shipped agent releases.", error)
  }
}
