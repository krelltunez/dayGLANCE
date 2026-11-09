import XCTest

// The Project widget's due badge (#2160): a project's own target date, shown
// as the Goal widget shows a goal's. ProjectData.dueDays (WidgetModels.swift)
// decides whether there is a badge and what day count it carries.
final class ProjectDueBadgeTests: XCTestCase {

    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Denver")!
        return c
    }()

    /// Noon on the given local day, as a widget entry's date.
    private func day(_ y: Int, _ m: Int, _ d: Int) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
    }

    private func project(_ json: String) throws -> ProjectData {
        try JSONDecoder().decode(ProjectData.self, from: Data(json.utf8))
    }

    func testDecodesTheTargetDateAndToleratesAnOlderPush() throws {
        let dated = try project(#"{"id":"p","title":"Roof","status":"active","targetDate":"2026-09-24","daysUntilDue":3}"#)
        XCTAssertEqual(dated.targetDate, "2026-09-24")
        XCTAssertEqual(dated.daysUntilDue, 3)
        let older = try project(#"{"id":"p","title":"Roof","status":"active"}"#)
        XCTAssertNil(older.targetDate)
        XCTAssertNil(older.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar))
    }

    func testCountsDaysFromTheEntrysDayAtRenderTime() throws {
        let p = try project(#"{"id":"p","status":"active","targetDate":"2026-09-24","daysUntilDue":99}"#)
        XCTAssertEqual(p.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar), 3)
        XCTAssertEqual(p.dueDays(from: day(2026, 9, 24), isStale: false, calendar: calendar), 0)
        XCTAssertEqual(p.dueDays(from: day(2026, 9, 26), isStale: false, calendar: calendar), -2)
    }

    func testFallsBackToThePushedCountOnlyWhenTheDateDoesNotParse() throws {
        let p = try project(#"{"id":"p","status":"active","targetDate":"soon","daysUntilDue":4}"#)
        XCTAssertEqual(p.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar), 4)
    }

    func testNoBadgeOnAStaleSnapshotOrACompletedProjectOrWithoutADate() throws {
        let p = try project(#"{"id":"p","status":"active","targetDate":"2026-09-24"}"#)
        XCTAssertNil(p.dueDays(from: day(2026, 9, 21), isStale: true, calendar: calendar))
        let done = try project(#"{"id":"p","status":"completed","targetDate":"2026-09-24"}"#)
        XCTAssertNil(done.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar))
        let blank = try project(#"{"id":"p","status":"active","targetDate":"","daysUntilDue":2}"#)
        XCTAssertNil(blank.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar))
    }

    func testAProjectOnHoldHasNoBadgeAndSaysSo() throws {
        let paused = try project(#"{"id":"p","status":"on-hold","targetDate":"2026-09-24","daysUntilDue":3}"#)
        XCTAssertTrue(paused.isOnHold)
        XCTAssertNil(paused.dueDays(from: day(2026, 9, 21), isStale: false, calendar: calendar))
        let active = try project(#"{"id":"p","status":"active","targetDate":"2026-09-24"}"#)
        XCTAssertFalse(active.isOnHold)
    }

    func testTheLiveFixtureStillDecodes() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "widgetSnapshot.live", withExtension: "json"))
        let snapshot = try XCTUnwrap(decodeSnapshot(try Data(contentsOf: url)))
        XCTAssertNotNil(snapshot.allProjects)
    }
}
