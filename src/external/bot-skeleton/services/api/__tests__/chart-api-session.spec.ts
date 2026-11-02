import chart_api from '../chart-api';

jest.mock('../appId', () => ({ generateDerivApiInstance: jest.fn() }));

describe('chart_api reconnecting', () => {
    beforeEach(() => {
        localStorage.clear();
        chart_api.api = { connection: { readyState: 3 } };
        jest.spyOn(chart_api, 'init').mockImplementation(async () => {});
    });

    afterEach(() => jest.restoreAllMocks());

    it('ct_session_v2 on: never reconnects on its own - api_base owns reconnecting', () => {
        localStorage.setItem('ct_session_v2', '1');
        chart_api.onsocketclose();
        expect(chart_api.init).not.toHaveBeenCalled();
    });

    it('ct_session_v2 off: reconnects on close, as before', () => {
        chart_api.onsocketclose();
        expect(chart_api.init).toHaveBeenCalledWith(true);
    });
});
