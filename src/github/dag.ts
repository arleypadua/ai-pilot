import type { AutoPilotConfig, DAGNode, GitHubIssue, TaskStatus } from '../types/index.js';
import { parseIssueDependencies } from './parser.js';

export class IssueDAG {
  private nodes: Map<number, DAGNode> = new Map();
  private config: AutoPilotConfig;

  constructor(config: AutoPilotConfig) {
    this.config = config;
  }

  public build(issues: GitHubIssue[]): void {
    this.nodes.clear();

    const issueMap = new Map<number, GitHubIssue>();
    for (const issue of issues) {
      issueMap.set(issue.number, issue);
    }

    // First pass: create all nodes
    for (const issue of issues) {
      const deps = parseIssueDependencies(issue);
      const node: DAGNode = {
        issue,
        kind: deps.kind,
        blockers: [...deps.blockers],
        dependents: [],
        parentNumber: deps.parentNumber,
        children: [...deps.subTaskNumbers],
        status: 'pending',
      };
      this.nodes.set(issue.number, node);
    }

    // Second pass: establish two-way relationships (dependents, parent/child)
    for (const [issueNumber, node] of this.nodes.entries()) {
      // Connect blockers to dependents
      for (const blockerId of node.blockers) {
        const blockerNode = this.nodes.get(blockerId);
        if (blockerNode && !blockerNode.dependents.includes(issueNumber)) {
          blockerNode.dependents.push(issueNumber);
        }
      }

      // Connect parent to children
      if (node.parentNumber) {
        const parentNode = this.nodes.get(node.parentNumber);
        if (parentNode && !parentNode.children.includes(issueNumber)) {
          parentNode.children.push(issueNumber);
        }
      }

      // Connect children to parent
      for (const childId of node.children) {
        const childNode = this.nodes.get(childId);
        if (childNode && childNode.parentNumber === undefined) {
          childNode.parentNumber = issueNumber;
          childNode.kind = 'ticket';
        }
      }
    }

    // Third pass: evaluate status for each node
    for (const [issueNumber, node] of this.nodes.entries()) {
      node.status = this.evaluateStatus(node, issueMap);
    }
  }

  private evaluateStatus(node: DAGNode, issueMap: Map<number, GitHubIssue>): TaskStatus {
    const { issue } = node;

    if (issue.state === 'CLOSED') {
      return 'completed';
    }

    const labelNames = new Set(issue.labels.map((l) => l.name.toLowerCase()));
    const readyLabel = this.config.labels.readyForAgent.toLowerCase();
    const needsInfoLabel = this.config.labels.needsInfo.toLowerCase();
    const readyForHumanLabel = this.config.labels.readyForHuman.toLowerCase();
    const wontfixLabel = this.config.labels.wontfix.toLowerCase();

    if (labelNames.has(wontfixLabel)) {
      return 'completed'; // Treat wontfix as non-blocking terminal
    }

    if (labelNames.has(needsInfoLabel) || labelNames.has(readyForHumanLabel)) {
      return 'waiting_feedback';
    }

    if (!labelNames.has(readyLabel)) {
      return 'pending';
    }

    // Check blockers
    for (const blockerId of node.blockers) {
      const blockerIssue = issueMap.get(blockerId);
      // If blocker is missing or open, this task is blocked
      if (!blockerIssue || blockerIssue.state === 'OPEN') {
        return 'blocked';
      }
    }

    return 'ready';
  }

  public getNode(issueNumber: number): DAGNode | undefined {
    return this.nodes.get(issueNumber);
  }

  public getAllNodes(): DAGNode[] {
    return Array.from(this.nodes.values());
  }

  public getReadyNodes(): DAGNode[] {
    return this.getAllNodes().filter((n) => n.status === 'ready');
  }

  public getBlockedNodes(): DAGNode[] {
    return this.getAllNodes().filter((n) => n.status === 'blocked');
  }

  public getWaitingFeedbackNodes(): DAGNode[] {
    return this.getAllNodes().filter((n) => n.status === 'waiting_feedback');
  }

  public getUnresolvedBlockers(issueNumber: number): number[] {
    const node = this.nodes.get(issueNumber);
    if (!node) return [];

    const unresolved: number[] = [];
    for (const blockerId of node.blockers) {
      const blockerNode = this.nodes.get(blockerId);
      if (!blockerNode || blockerNode.issue.state === 'OPEN') {
        unresolved.push(blockerId);
      }
    }
    return unresolved;
  }
}
