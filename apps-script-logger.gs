/**
 * Приёмник событий юзтест-прототипа → Google-таблица.
 *
 * Как развернуть (5 минут, один раз):
 * 1. Создайте Google-таблицу (sheets.new), назовите, например, «Тест <название> — события».
 * 2. В таблице: Расширения → Apps Script. Удалите заглушку, вставьте этот файл целиком.
 * 3. Нажмите «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»:
 *    – «Выполнять от имени»: от моего имени;
 *    – «У кого есть доступ»: ВСЕ (иначе события респондентов не дойдут).
 * 4. Разрешите доступы, скопируйте URL вида https://script.google.com/macros/s/…/exec
 * 5. Пришлите этот URL агенту — он зашьёт его в сборку и перепубликует прототипы.
 *
 * Каждое событие — строка: время сервера, id сессии, группа, секунды от старта,
 * событие, детали. Первая строка-шапка создаётся автоматически.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['received_at', 'session', 'group', 't_sec', 'event', 'data']);
    }
    var payload = JSON.parse(e.postData.contents);
    var rows = (payload.events || []).map(function (ev) {
      return [
        new Date(),
        payload.sessionId || '',
        payload.group || '',
        Math.round((ev.t || 0) / 100) / 10,
        ev.type || '',
        ev.data || '',
      ];
    });
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('err: ' + err);
  } finally {
    lock.releaseLock();
  }
}
