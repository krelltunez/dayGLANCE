"""Run the native mobile suite, then exercise repeated attempts and stale drafts.
Same prerequisites and environment variables as jobo-mobile-review.py.
"""
import json
import os
import runpy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = runpy.run_path(str(Path(__file__).with_name('jobo-mobile-review.py')))
profile, check, require = base['profile'], base['check'], base['require']
read_ledger, key, out = base['read_ledger'], base['KEY'], base['OUT']
results, errors = base['RESULTS'], base['ERRORS']

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}))
    context, page = profile(browser)
    try:
        def repeat_attempt():
            page.locator('[data-mobile-card="do"][data-record-id="review-actual"]').click()
            before = read_ledger(page)
            page.get_by_role('dialog').locator('[data-mobile-repeat]').click()
            dialog = page.get_by_role('dialog')
            expect(dialog.get_by_label('名称', exact=True)).to_have_value('学习英语')
            dialog.get_by_label('开始', exact=True).fill('16:00')
            dialog.get_by_label('结束', exact=True).fill('16:30')
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog).not_to_be_visible()
            after = read_ledger(page)
            require(len(after['records']) == len(before['records']) + 1, 'Repeat must append one attempt')
            require(after['records'][:-1] == before['records'], 'Repeat modified existing attempts')
            require(after['records'][-1]['sourceTaskId'] == 'review-english', 'Repeat lost its source')
        check('repeat actual appends independently without rewriting the first attempt', repeat_attempt, page)

        def conflict_safety():
            page.locator('[data-mobile-card="do"][data-record-id="review-actual"]').click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('结束', exact=True).fill('15:15')
            page.evaluate("""(key) => {
                const previous = localStorage.getItem(key), state = JSON.parse(previous);
                state.records[0].duration = 55;
                const next = JSON.stringify(state);
                localStorage.setItem(key, next);
                window.dispatchEvent(new StorageEvent('storage', {key, oldValue: previous,
                    newValue: next, storageArea: localStorage}));
            }""", key)
            dialog.get_by_role('button', name='保存', exact=True).click()
            expect(dialog.get_by_role('alert')).to_be_visible()
            expect(dialog.get_by_label('结束', exact=True)).to_have_value('15:15')
            require(read_ledger(page)['records'][0]['duration'] == 55, 'Stale sheet overwrote newer data')
            dialog.get_by_role('button', name='取消', exact=True).click()
        check('stale editor retains its draft without overwriting newer actual data', conflict_safety, page)

        def optional_fields():
            page.locator('[data-jobo-mobile]').get_by_role('button', name='新增执行', exact=True).click()
            dialog = page.get_by_role('dialog')
            # A wrapping label includes option text in Playwright's text matching.
            # Require the real control to exist even while its details are closed.
            linked = dialog.get_by_label('关联任务', exact=False)
            expect(linked).to_have_count(1)
            expect(linked).not_to_be_visible()
            dialog.locator('summary').click()
            expect(linked).to_be_visible()
            linked.select_option('review-english')
            expect(dialog.get_by_label('名称', exact=True)).to_have_value('学习英语')
            dialog.get_by_role('button', name='取消', exact=True).click()
        check('secondary recording fields stay collapsed until requested', optional_fields, page)
        def chinese_copy():
            expect(page.locator('.jobo-mobile-head b')).to_have_text(['计划', '执行'])
            expect(page.locator('.jobo-mobile-comparison')).to_have_attribute('aria-label', '计划 / 执行')
            expect(page.locator('[data-jobo-mobile-toggle]')).to_have_text('Plan / Do')
        check('Chinese comparison uses the shared Plan / Do labels', chinese_copy, page)

        def english_copy():
            page.evaluate("localStorage.setItem('i18nextLng', 'en')")
            page.reload(wait_until='networkidle')
            page.get_by_role('button').filter(has=page.get_by_text('Timeline', exact=True)).click()
            expect(page.locator('[data-jobo-mobile]')).to_be_visible()
            expect(page.locator('.jobo-mobile-head b')).to_have_text(['Plan', 'Do'])
            expect(page.locator('.jobo-mobile-comparison')).to_have_attribute('aria-label', 'Plan / Do')
            expect(page.locator('[data-jobo-mobile-toggle]')).to_have_attribute('aria-label', 'Switch between Plan / Do and the original time grid')
            base['shot'](page, 'mobile-english-plan-do')
        check('English heading and accessible labels use Plan / Do', english_copy, page)
    finally:
        context.close()
        browser.close()
        report = {'screenshots': 'Actual production app in Chromium mobile emulation; not a physical phone.',
                  'tests': results, 'uncaughtErrors': errors}
        (out / 'browser-review-extended.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if errors or any(not result['passed'] for result in results):
            raise SystemExit(1)
