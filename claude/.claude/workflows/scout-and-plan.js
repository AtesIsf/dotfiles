export const meta = {
  name: 'scout-and-plan',
  description: 'Scout gathers context, planner writes the implementation plan (no implementation)',
  phases: [{ title: 'Scout' }, { title: 'Plan' }],
}

// args: task description (string) or { task }
const task = typeof args === 'string' ? args : args?.task
if (!task) throw new Error('scout-and-plan: pass the task as args')

const recon = await agent(`Find all code relevant to: ${task}`, { label: 'scout', phase: 'Scout', agentType: 'scout' })

return await agent(
  `Create an implementation plan for "${task}" using this reconnaissance:

${recon}`,
  { label: 'planner', phase: 'Plan', agentType: 'planner' },
)
