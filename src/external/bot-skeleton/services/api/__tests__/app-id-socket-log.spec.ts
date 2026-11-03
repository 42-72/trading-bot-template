/**
 * The socket factory's reuse paths log a line (connection log only): a
 * socket handed back without being made logs no socket_create / otp_ok, so
 * without it a reconnect could reach "authorized" with no visible steps.
 */
import { readConnLog } from '@/utils/connection-log';
import { clearDerivApiInstance, generateDerivApiInstance } from '../appId';

jest.mock('@/components/shared', () => ({
    getSocketURL: jest.fn(() => Promise.resolve('wss://x.example/ws?otp=SECRET')),
}));
jest.mock('@deriv/deriv-api/dist/DerivAPIBasic', () =>
    jest.fn().mockImplementation(({ connection }) => ({ connection }))
);
jest.mock('../api-middleware', () => jest.fn());

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = 0;
    addEventListener = jest.fn();
    close = jest.fn();
}

describe('generateDerivApiInstance - connection log', () => {
    const original_websocket = global.WebSocket;

    beforeAll(() => {
        (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    });

    afterAll(() => {
        (global as unknown as { WebSocket: unknown }).WebSocket = original_websocket;
    });

    beforeEach(() => {
        localStorage.clear();
        clearDerivApiInstance();
    });

    it('a new socket logs socket_create; handing back the open one logs socket_reused with who asked', async () => {
        const first = await generateDerivApiInstance();
        (first.connection as FakeWebSocket).readyState = 1;
        const again = await generateDerivApiInstance(false, 'chart');

        expect(again).toBe(first);
        const names = readConnLog().map(entry => entry.e);
        expect(names).toEqual(['socket_create', 'socket_reused']);
        expect(readConnLog()[1].d).toBe('chart - open authenticated socket');
        expect(JSON.stringify(readConnLog())).not.toContain('SECRET');
    });

    it('joining a creation already under way logs socket_create_shared', async () => {
        const [a, b] = await Promise.all([generateDerivApiInstance(), generateDerivApiInstance(false, 'chart')]);
        expect(b).toBe(a);
        expect(readConnLog().map(entry => entry.e)).toEqual(['socket_create_shared', 'socket_create']);
        expect(readConnLog()[0].d).toBe('chart - joins a socket creation already under way');
    });
});
