import type { GitHubIssue, ParsedDependencies, TaskKind } from '../types/index.js';

export function parseIssueDependencies(issue: GitHubIssue): ParsedDependencies {
  const content = `${issue.title}\n${issue.body || ''}`;
  const blockers: Set<number> = new Set();
  let parentNumber: number | undefined = undefined;
  const subTaskNumbers: Set<number> = new Set();

  // 1. Parse "Blocked by #123", "Blocked by: #123, #124", "Blocked by #123, #124"
  const blockedByRegex = /(?:blocked\s+by|depends\s+on|blocker(?:\s*is)?)[:\s]+((?:#?\d+[\s,]*)+)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockedByRegex.exec(content)) !== null) {
    const rawIds = match[1];
    const idMatches = rawIds.match(/\d+/g);
    if (idMatches) {
      for (const idStr of idMatches) {
        const id = parseInt(idStr, 10);
        if (id !== issue.number) {
          blockers.add(id);
        }
      }
    }
  }

  // 2. Parse "Parent: #123", "Parent issue: #123", "Child of #123"
  const parentRegex = /(?:parent(?:\s+issue)?|child\s+of)[:\s]+#?(\d+)/i;
  const parentMatch = content.match(parentRegex);
  if (parentMatch && parentMatch[1]) {
    const parsedParent = parseInt(parentMatch[1], 10);
    if (parsedParent !== issue.number) {
      parentNumber = parsedParent;
    }
  }

  // 3. Parse Markdown Task Lists: "- [ ] #123" or "- [x] #123" or "Subtasks:\n- #123"
  const taskListRegex = /[-*]\s*\[[ xX]\]\s*#(\d+)/g;
  while ((match = taskListRegex.exec(content)) !== null) {
    const subTaskId = parseInt(match[1], 10);
    if (subTaskId !== issue.number) {
      subTaskNumbers.add(subTaskId);
    }
  }

  // 4. Determine Task Kind
  let kind: TaskKind = 'standalone';
  const isSpecTitle = /^(?:\[spec\]|spec:)/i.test(issue.title);
  const hasAcceptanceCriteria = /(?:acceptance\s+criteria|specifications?|requirements)/i.test(issue.body || '');
  const hasSubTasks = subTaskNumbers.size > 0;

  if (parentNumber !== undefined) {
    kind = 'ticket';
  } else if (isSpecTitle || (hasAcceptanceCriteria && hasSubTasks)) {
    kind = 'spec';
  }

  return {
    blockers: Array.from(blockers),
    parentNumber,
    subTaskNumbers: Array.from(subTaskNumbers),
    kind,
  };
}
