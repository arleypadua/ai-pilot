import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventBus } from '../src/events/bus.js';

describe('AgentEventBus', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = AgentEventBus.getInstance();
    bus.clearHistory();
  });

  it('should emit and store structured agent events', () => {
    const emitted: any[] = [];
    bus.on('agent_event', (e) => emitted.push(e));

    const event = bus.emitAgentEvent({
      issueNumber: 101,
      type: 'tool_start',
      summary: 'Tool: EditFile src/index.ts',
      detail: { file: 'src/index.ts' },
    });

    expect(event.id).toBeDefined();
    expect(event.issueNumber).toBe(101);
    expect(event.type).toBe('tool_start');
    expect(emitted.length).toBe(1);
    expect(emitted[0].summary).toBe('Tool: EditFile src/index.ts');

    const history = bus.getHistory(101);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(event.id);
  });

  it('should isolate history by issue number', () => {
    bus.emitAgentEvent({
      issueNumber: 1,
      type: 'thought',
      summary: 'Thinking about issue 1',
    });

    bus.emitAgentEvent({
      issueNumber: 2,
      type: 'thought',
      summary: 'Thinking about issue 2',
    });

    expect(bus.getHistory(1).length).toBe(1);
    expect(bus.getHistory(2).length).toBe(1);
    expect(bus.getHistory(1)[0].summary).toContain('issue 1');
    expect(bus.getHistory(2)[0].summary).toContain('issue 2');
    expect(bus.getHistory(3).length).toBe(0);
  });
});
