export const meta = {
  name: 'implement',
  description: 'Worker implements, reviewer reviews, worker applies the review',
  phases: [{ title: 'Implement' }, { title: 'Review' }, { title: 'Apply feedback' }],
}

// args: task description (string) or { task }
const task = typeof args === 'string' ? args : args?.task
if (!task) throw new Error('implement: pass the task as args')

const impl = await agent(`Implement: ${task}`, { label: 'worker', phase: 'Implement', agentType: 'worker' })

const review = await agent(
  `Review this implementation of "${task}". Inspect the actual changes with git status/diff and read the touched files.

Worker's report:
${impl}`,
  { label: 'reviewer', phase: 'Review', agentType: 'reviewer' },
)

const final = await agent(
  `You implemented "${task}". Apply the feedback from this review (fix Critical and Warnings; Suggestions only if trivial):

${review}`,
  { label: 'worker (fixes)', phase: 'Apply feedback', agentType: 'worker' },
)

return { review, final }
