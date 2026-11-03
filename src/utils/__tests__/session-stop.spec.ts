import { dismissNoticeOnRunAgain, stopRunsForSession } from '../session-stop';
import { session_status } from '../session-status';

jest.mock('@deriv-com/translations', () => ({ localize: (text: string) => text }));

const setup = ({ is_running = false, is_scanner_active = false } = {}) => {
    const targets = {
        is_running,
        ai_scanner: { is_active: is_scanner_active, stopForSession: jest.fn() },
        journal: { pushMessage: jest.fn() },
        stopBot: jest.fn(),
        error_message_type: 'error',
    };
    return targets;
};

describe('stopRunsForSession', () => {
    it('connection lost with a bot running: Stop path, Journal "Connection lost – bot stopped"', () => {
        const targets = setup({ is_running: true });
        expect(stopRunsForSession(targets, 'connection_lost')).toBe(true);
        expect(targets.stopBot).toHaveBeenCalledTimes(1);
        expect(targets.journal.pushMessage).toHaveBeenCalledWith('Connection lost – bot stopped', 'error', '');
    });

    it('real expiry with a bot running: stopped, Journal "Session expired – bot stopped"', () => {
        const targets = setup({ is_running: true });
        stopRunsForSession(targets, 'session_expired');
        expect(targets.stopBot).toHaveBeenCalledTimes(1);
        expect(targets.journal.pushMessage).toHaveBeenCalledWith('Session expired – bot stopped', 'error', '');
    });

    it('AI Scanner active: the scanner stops (its own bot through the Stop path), not stopBot twice', () => {
        const targets = setup({ is_running: true, is_scanner_active: true });
        stopRunsForSession(targets, 'connection_lost');
        expect(targets.ai_scanner.stopForSession).toHaveBeenCalledWith('Connection lost – bot stopped');
        expect(targets.stopBot).not.toHaveBeenCalled();
    });

    it('AI Scanner scanning with no bot yet: "Connection lost – AI Scanner stopped"', () => {
        const targets = setup({ is_scanner_active: true });
        stopRunsForSession(targets, 'connection_lost');
        expect(targets.ai_scanner.stopForSession).toHaveBeenCalledWith('Connection lost – AI Scanner stopped');
    });

    it('nothing running: nothing stopped, no Journal entry, no notice', () => {
        const targets = setup();
        expect(stopRunsForSession(targets, 'connection_lost')).toBe(false);
        expect(targets.stopBot).not.toHaveBeenCalled();
        expect(targets.journal.pushMessage).not.toHaveBeenCalled();
    });
});

describe('dismissNoticeOnRunAgain (Run / Scan pressed again)', () => {
    beforeEach(() => {
        localStorage.clear();
        session_status.notice = null;
    });

    it('hides "Connection lost"', () => {
        session_status.setNotice('connection_lost');
        dismissNoticeOnRunAgain();
        expect(session_status.notice).toBeNull();
    });

    it('"Session expired" stays until the trader logs in', () => {
        session_status.setNotice('session_expired');
        dismissNoticeOnRunAgain();
        expect(session_status.notice).toBe('session_expired');
    });
});
