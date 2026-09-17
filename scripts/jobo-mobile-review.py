"""Exercise the production app in Chromium with synthetic local-only data.
Requires playwright==1.55.0 and Chromium. Run against npm run preview.
"""
import json
import os
import re
import traceback
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('REVIEW_OUT', 'review-artifacts'))
OUT.mkdir(parents=True, exist_ok=True)
URL = os.environ.get('REVIEW_URL', 'http://127.0.0.1:5173')
DATE = '2026-09-16'
KEY = 'day-planner-jobo-v520'
TASKS = [dict(id='review-english', title='学习英语', date=DATE, startTime='14:00', duration=60, color='bg-blue-500', completed=False, notes='复习单词，完成一篇阅读。'), dict(id='review-fitness', title='锻炼身体', date=DATE, startTime='17:00', duration=60, color='bg-green-500', completed=False, notes='')]
LEDGER = dict(version=3, plans={task['id']: dict(task, projectId=None, capturedAt=DATE+'T05:00:00.000Z') for task in TASKS}, records=[dict(id='review-actual', planId='review-english', sourceTaskId='review-english', date=DATE, startTime='14:10', duration=40, title='学习英语', color='bg-blue-500', progress='complete', notes='复习单词，完成一篇阅读。', notesOwn=False, tags=[], projectId=None, createdAt=DATE+'T06:50:00.000Z', updatedAt=DATE+'T06:50:00.000Z')], noteHeights={}, notePresence={}, planTags={}, prefs=dict(dayScale=84, weekScale=1, allHours=False))
RESULTS = []
ERRORS = []

def seed(dark=False, enabled=True):
    return {'day-planner-tasks': json.dumps(TASKS, ensure_ascii=False), 'day-planner-unscheduled': '[]', KEY: json.dumps(LEDGER, ensure_ascii=False), 'day-planner-jobo-enabled': json.dumps(enabled), 'day-planner-use-24h-clock': 'true', 'day-planner-darkmode': json.dumps(dark), 'day-planner-daily-notes': '{}', 'day-planner-mobile-default-view': '"grid"', 'welcomeDismissed': 'true', 'gettingStartedDismissed': 'true', 'i18nextLng': 'zh-CN', 'day-planner-weather-enabled': 'false', 'day-planner-daily-content-enabled': 'false'}

def timeline(page):
    # The native tab can include an overdue count before its visible label.
    page.get_by_role('button').filter(has=page.get_by_text('时间线', exact=True)).click()

def shot(page, name):
    page.screenshot(path=str(OUT / (name+'.png')), full_page=False)
    (OUT / (name+'.txt')).write_text(page.locator('body').inner_text(), encoding='utf-8')

def profile(browser, width=393, height=852, dark=False, enabled=True, mobile=True):
    context = browser.new_context(viewport={'width': width, 'height': height}, screen={'width': width, 'height': height}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='zh-CN', timezone_id='Asia/Shanghai')
    context.route(re.compile(r'^(?!http://127\.0\.0\.1:5173/).*'), lambda route: route.abort())
    context.add_init_script('if (!localStorage.getItem("jobo-review-seeded")) { const values = '+json.dumps(seed(dark, enabled), ensure_ascii=False)+'; for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value); localStorage.setItem("jobo-review-seeded","true"); }')
    page = context.new_page()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: ERRORS.append(str(error)))
    page.clock.set_fixed_time(datetime(2026, 9, 16, 8, 10, tzinfo=timezone.utc))
    try:
        page.goto(URL, wait_until='networkidle', timeout=60000)
        if mobile:
            timeline(page)
            if enabled: page.wait_for_selector('[data-jobo-mobile]')
        page.wait_for_timeout(700)
        return context, page
    except Exception:
        shot(page, f'failure-profile-{width}-{dark}-{enabled}')
        (OUT/'failure-storage.json').write_text(json.dumps(page.evaluate('Object.fromEntries(Object.entries(localStorage))'), ensure_ascii=False, indent=2))
        context.close()
        raise

def read_ledger(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', KEY)

def no_overflow(page):
    return page.evaluate('document.documentElement.scrollWidth <= innerWidth')

def check(name, test, page=None):
    try:
        test()
        RESULTS.append({'test': name, 'passed': True})
    except Exception as error:
        RESULTS.append({'test': name, 'passed': False, 'error': str(error)})
        traceback.print_exc()
        if page: shot(page, 'failure-'+str(len(RESULTS)))

def require(value, message):
    assert value, message

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}))
    context = None
    try:
        context, page = profile(browser)
        check('single axis with circled hours, two distinct aligned lanes', lambda: (
            expect(page.locator('[data-mobile-axis]')).to_have_count(1),
            expect(page.locator('.jobo-mobile-hour')).to_have_count(25),
            expect(page.locator('[data-mobile-lane]')).to_have_count(2),
            require(no_overflow(page), 'Horizontal overflow'),
            expect(page.get_by_role('button', name='重新聚焦时间线', exact=True)).not_to_be_visible()), page)
        shot(page, 'mobile-light-393')
        page.locator('[data-mobile-card="do"]').first.click()
        expect(page.get_by_role('dialog')).to_be_visible()
        shot(page, 'mobile-record-editor')
        def edit_actual():
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('结束', exact=True).fill('15:00')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog).not_to_be_visible()
            require(read_ledger(page)['records'][0]['duration'] == 50, 'Actual edit did not persist')
            tasks = page.evaluate('JSON.parse(localStorage.getItem("day-planner-tasks"))')
            require(all(not task['completed'] for task in tasks), 'Actual edit completed a native task')
            require(tasks[0]['startTime'] == '14:00', 'Actual edit moved original task')
        check('edit actual persists without completing or moving native task', edit_actual, page)
        def add_actual():
            page.locator('[data-jobo-mobile]').get_by_role('button', name='新增执行', exact=True).click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('名称', exact=True).fill('临时电话')
            dialog.get_by_label('开始', exact=True).fill('15:10')
            dialog.get_by_label('结束', exact=True).fill('15:25')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog).not_to_be_visible()
            require(len(read_ledger(page)['records']) == 2, 'Expected one new record')
            require(read_ledger(page)['records'][-1]['planId'] is None, 'Unplanned record fabricated a plan')
        check('quick-add unplanned actual', add_actual, page)
        def reload_persistence():
            page.reload(wait_until='networkidle')
            timeline(page)
            page.wait_for_selector('[data-jobo-mobile]')
            require(len(read_ledger(page)['records']) == 2, 'Records lost on reload')
            expect(page.locator('[data-mobile-card="do"]')).to_have_count(2)
        check('reload retains actual records', reload_persistence, page)
        def daily_note():
            page.locator('[data-mobile-daily-note]').click()
            page.locator('textarea:visible').first.fill('阅读完成了。下午继续，把运动也安排好。')
            page.get_by_role('button', name=re.compile('^关闭 .*')).last.click()
            expect(page.locator('[data-mobile-daily-note]')).to_contain_text('阅读完成了')
            require('阅读完成了' in page.evaluate('JSON.parse(localStorage.getItem("day-planner-daily-notes"))')[DATE]['text'], 'Native daily note did not persist')
        check('native daily note editor persists to original store', daily_note, page)
        shot(page, 'mobile-light-with-notes')
        def original_grid():
            page.locator('[data-jobo-mobile-toggle]').click()
            expect(page.locator('[data-jobo-mobile]')).to_have_count(0)
            expect(page.locator('.calendar-slot').first).to_be_attached()
            page.locator('[data-jobo-mobile-toggle]').click()
            expect(page.locator('[data-jobo-mobile]')).to_be_visible()
        check('one tap restores original native grid and returns', original_grid, page)
        def quota_failure():
            page.locator('[data-jobo-mobile]').get_by_role('button', name='新增执行', exact=True).click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('名称', exact=True).fill('保存失败也不能丢失')
            page.evaluate('''() => { window.reviewOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k === 'day-planner-jobo-v520') throw new DOMException('Quota test', 'QuotaExceededError'); return window.reviewOriginalSetItem.call(this,k,v); }; }''')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog.get_by_role('alert')).to_be_visible()
            expect(dialog.get_by_label('名称', exact=True)).to_have_value('保存失败也不能丢失')
            page.evaluate('() => { Storage.prototype.setItem = window.reviewOriginalSetItem; }')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog).not_to_be_visible()
            require(len(read_ledger(page)['records']) == 3, 'Retry created duplicate/missing record')
        check('quota failure keeps input, retry creates exactly one record', quota_failure, page)
        def refocus():
            grid = page.locator('[data-mobile-timeline]')
            grid.evaluate('(el) => { el.scrollTop = 0; }')
            page.get_by_role('button', name='重新聚焦时间线', exact=True).click()
            page.wait_for_timeout(800)
            require(abs(grid.evaluate('(el) => el.scrollTop') - 16*84) < 5, 'Refocus scrolled wrong container')
            expect(page.get_by_role('button', name='重新聚焦时间线', exact=True)).not_to_be_visible()
        check('native refocus action targets shared inner axis', refocus, page)
        def native_add():
            page.locator('[data-jobo-mobile]').get_by_role('button', name='添加计划', exact=True).click()
            title = page.get_by_placeholder('任务标题', exact=True)
            title.fill('通过原生编辑器添加计划')
            page.locator('form').filter(has=title).locator('button[type="submit"]').click()
            expect(title).not_to_be_visible()
            require(any(task['title'] == '通过原生编辑器添加计划' and task['date'] == DATE for task in page.evaluate('JSON.parse(localStorage.getItem("day-planner-tasks"))')), 'Native plan was not saved')
        check('Plan plus uses original task form and original store', native_add, page)
        def checklist_record():
            page.get_by_role('button', name='记录「锻炼身体」的实际时间', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog.get_by_label('名称', exact=True)).to_have_value('锻炼身体')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog).not_to_be_visible()
            record = read_ledger(page)['records'][-1]
            require(record['sourceTaskId'] == 'review-fitness', 'Task link missing')
            page.locator('[data-mobile-card="do"][data-record-id="'+record['id']+'"]').click()
            page.once('dialog', lambda prompt: prompt.accept())
            page.get_by_role('dialog').get_by_role('button', name='删除执行记录', exact=True).click()
            require(not any(item['id'] == record['id'] for item in read_ledger(page)['records']), 'Delete failed')
            page.get_by_role('button', name='账簿操作', exact=True).click()
            page.get_by_role('button', name='撤销账簿操作', exact=True).click()
            require(any(item['id'] == record['id'] for item in read_ledger(page)['records']), 'Undo failed')
            require(not next(task for task in page.evaluate('JSON.parse(localStorage.getItem("day-planner-tasks"))') if task['id'] == 'review-fitness')['completed'], 'Recording completed the native task')
        check('task checklist records, deletes and undoes independently', checklist_record, page)
        context.close(); context = None
        for width, height, dark in [(393,852,True),(320,740,False),(430,932,False)]:
            context, page = profile(browser, width, height, dark)
            check(f'{width}px {"dark" if dark else "light"} no horizontal overflow or lost heading', lambda: (
                require(no_overflow(page), 'Horizontal overflow'),
                require(page.locator('.jobo-mobile-section-title').first.bounding_box()['y'] >= 100, 'Outer calendar auto-scrolled past task list')) , page)
            shot(page, f'mobile-{"dark" if dark else "light"}-{width}')
            context.close(); context = None
        context, page = profile(browser, enabled=False)
        check('feature OFF leaves native mobile grid untouched', lambda: (
            expect(page.locator('[data-jobo-mobile]')).to_have_count(0),
            expect(page.locator('[data-jobo-mobile-toggle]')).to_have_count(0),
            expect(page.locator('.calendar-slot').first).to_be_attached()), page)
        shot(page, 'native-grid-feature-off'); context.close(); context = None
        context, page = profile(browser, width=1440, height=1000, mobile=False)
        check('desktop does not mount phone UI', lambda: expect(page.locator('[data-jobo-mobile]')).to_have_count(0), page)
        shot(page, 'desktop-regression'); context.close(); context = None
        require(not ERRORS, 'Uncaught browser errors: '+str(ERRORS))
    except Exception as error:
        RESULTS.append({'test': 'browser setup / suite', 'passed': False, 'error': str(error)})
        traceback.print_exc()
        if context:
            for index, tab in enumerate(context.pages): shot(tab, 'failure-setup-'+str(index))
    finally:
        if context: context.close()
        browser.close()
        report = {'screenshots': 'Actual Chromium production-app rendering; mobile emulation, not a physical phone.', 'tests': RESULTS, 'uncaughtErrors': ERRORS}
        (OUT/'browser-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if any(not result['passed'] for result in RESULTS): raise SystemExit(1)
