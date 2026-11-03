import { SILENT_NOTIFICATION_SOUND } from '../../../constants/config';
import { observer as globalObserver } from '../../../utils/observer';

export const contract = c => globalObserver.emit('bot.contract', c);

export const contractStatus = c => globalObserver.emit('contract.status', c);

export const info = i => globalObserver.emit('bot.info', i);

export const notify = (className, message) =>
    globalObserver.emit('ui.log.notify', { className, message, sound: SILENT_NOTIFICATION_SOUND });

export const log = (log_type, extra) => globalObserver.emit('ui.log.success', { log_type, extra });

export const error = message => globalObserver.emit('ui.log.error', message);
