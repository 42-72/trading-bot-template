import { generateDerivApiInstance } from '../appId';
import chart_api from '../chart-api';

jest.mock('../appId', () => ({ generateDerivApiInstance: jest.fn() }));

const mockGenerate = generateDerivApiInstance as jest.Mock;

describe('chart_api', () => {
    beforeEach(() => {
        mockGenerate.mockReset();
        chart_api.api = undefined;
    });

    it('never reconnects on its own - it has no close handling; api_base owns reconnecting', () => {
        expect((chart_api as unknown as Record<string, unknown>).onsocketclose).toBeUndefined();
        expect((chart_api as unknown as Record<string, unknown>).reconnectIfNotConnected).toBeUndefined();
    });

    it('takes the shared socket api_base hands it on each (re)connect', async () => {
        const first = { send: jest.fn() };
        const second = { send: jest.fn() };
        mockGenerate.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        await chart_api.init();
        expect(chart_api.api).toBe(first);
        await chart_api.init(true);
        expect(chart_api.api).toBe(second);
    });
});
