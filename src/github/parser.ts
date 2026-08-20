import type { GitHubIssue, ParsedDependencies, TaskKind } from '../types/index.js';

function extractIssueIdsFromText(text: string): number[] {
  const ids = new Set<number>();

  // 1. Matches "#123" or "[#123]" or "[#123](url)"
  const hashMatches = text.matchAll(/#(\d+)/g);
  for (const m of hashMatches) {
    ids.add(parseInt(m[1], 10));
  }

  // 2. Matches GitHub issue URLs: "https://github.com/owner/repo/issues/123"
  const urlMatches = text.matchAll(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/gi);
  for (const m of urlMatches) {
    ids.add(parseInt(m[1], 10));
  }

  return Array.from(ids);
}

export function parseIssueDependencies(issue: GitHubIssue): ParsedDependencies {
  const body = issue.body || '';
  const content = `${issue.title}\n${body}`;
  const blockers: Set<number> = new Set();
  let parentNumber: number | undefined = issue.parent?.number;
  const subTaskNumbers: Set<number> = new Set();

  // 0. NATIVE GITHUB ISSUE RELATIONSHIPS
  if (issue.blockedBy) {
    for (const b of issue.blockedBy) {
      if (b.number !== issue.number) {
        blockers.add(b.number);
      }
    }
  }

  if (issue.subIssues) {
    for (const s of issue.subIssues) {
      if (s.number !== issue.number) {
        subTaskNumbers.add(s.number);
      }
    }
  }

  // 1. SECTION-BASED PARSER
  // Split markdown by headers (## or ###)
  const sections = body.split(/(?=^#{1,4}\s+)/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.split('\n')[0].toLowerCase();

    // Check if this section is a Blocker section
    const isBlockerSection =
      /^#{1,4}\s+(?:blocked\s+by|blockers?|dependencies|depends\s+on|prerequisites?)/i.test(firstLine);

    if (isBlockerSection) {
      const sectionIds = extractIssueIdsFromText(trimmed);
      for (const id of sectionIds) {
        if (id !== issue.number) {
          blockers.add(id);
        }
      }
    }

    // Check if this section is a Parent section (e.g. "## Parent\n\n#17 — ...")
    const isParentSection = /^#{1,4}\s+(?:parent(?:\s+issue)?|spec)/i.test(firstLine);
    if (isParentSection && parentNumber === undefined) {
      const sectionIds = extractIssueIdsFromText(trimmed);
      if (sectionIds.length > 0 && sectionIds[0] !== issue.number) {
        parentNumber = sectionIds[0];
      }
    }
  }

  // 2. LINE-BY-LINE / INLINE PARSER
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();

    // Inline Blocked by (e.g. "Blocked by [#222](url)", "Blocked by: #10, #12", "Depends on #45")
    if (/(?:blocked\s+by|depends\s+on|blocker(?:\s*is)?|prerequisite)[:\s]+/i.test(trimmedLine)) {
      const lineIds = extractIssueIdsFromText(trimmedLine);
      for (const id of lineIds) {
        if (id !== issue.number) {
          blockers.add(id);
        }
      }
    }

    // Inline Parent (e.g. "Parent: #123", "Child of #123", "Parent: [#123](url)")
    if (parentNumber === undefined && /(?:parent(?:\s+issue)?|child\s+of)[:\s]+/i.test(trimmedLine)) {
      const lineIds = extractIssueIdsFromText(trimmedLine);
      if (lineIds.length > 0 && lineIds[0] !== issue.number) {
        parentNumber = lineIds[0];
      }
    }
  }

  // 3. TASKLISTS & CHECKLISTS ("- [ ] #123" or "- [ ] [#123](url)" or "- [x] #123")
  const taskListRegex = /[-*]\s*\[[ xX]\]\s*(?:\[#?(\d+)\]\(|#?(\d+))/g;
  let match: RegExpExecArray | null;
  while ((match = taskListRegex.exec(content)) !== null) {
    const rawId = match[1] || match[2];
    if (rawId) {
      const subTaskId = parseInt(rawId, 10);
      if (subTaskId !== issue.number) {
        subTaskNumbers.add(subTaskId);
      }
    }
  }

  // 4. Determine Task Kind
  let kind: TaskKind = 'standalone';
  const isSpecTitle = /^(?:\[spec\]|spec:)/i.test(issue.title);
  const hasAcceptanceCriteria = /(?:acceptance\s+criteria|specifications?|requirements)/i.test(body);
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
