import { describe, expect, it, vi } from 'vitest';
import { createTerminalController } from '../src/terminal-controller';

describe('L-T1 TerminalController: open -> close -> terminal', () => {
  it('starts open, moves to closing on close(), and to terminal on forceTerminal()', () => {
    const controller = createTerminalController();
    expect(controller.lifecycle).toBe('open');
    controller.close();
    expect(controller.lifecycle).toBe('closing');
    controller.forceTerminal();
    expect(controller.lifecycle).toBe('terminal');
  });

  it('close() is idempotent and never regresses a further-along state', () => {
    const controller = createTerminalController();
    controller.close();
    controller.close();
    expect(controller.lifecycle).toBe('closing');
    controller.forceTerminal();
    controller.close();
    expect(controller.lifecycle).toBe('terminal');
  });

  it('forceTerminal() is idempotent', () => {
    const controller = createTerminalController();
    controller.forceTerminal();
    controller.forceTerminal();
    expect(controller.lifecycle).toBe('terminal');
  });

  it('whenTerminal() resolves exactly once, when terminal is reached', async () => {
    const controller = createTerminalController();
    const listener = vi.fn();
    void controller.whenTerminal().then(listener);
    void controller.whenTerminal().then(listener);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    controller.close();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    controller.forceTerminal();
    await controller.whenTerminal();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('terminal is not reachable again by calling open-phase transitions after terminal', () => {
    const controller = createTerminalController();
    controller.forceTerminal();
    // there is no API to reopen — assert the type stays terminal permanently
    controller.close();
    expect(controller.lifecycle).toBe('terminal');
  });
});
