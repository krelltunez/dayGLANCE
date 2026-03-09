package com.dayglance.app.data

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

class HealthRepository(context: Context) {

    private val client: HealthConnectClient? = if (
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
    ) {
        HealthConnectClient.getOrCreate(context)
    } else {
        null
    }

    val requiredPermissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
    )

    suspend fun getSteps(date: LocalDate): Int = withContext(Dispatchers.IO) {
        val c = client ?: return@withContext 0
        val zone = ZoneId.systemDefault()
        val start = date.atStartOfDay(zone).toInstant()
        val end = date.plusDays(1).atStartOfDay(zone).toInstant()
        try {
            // aggregate() deduplicates records across sources (phone, watch, Fit, etc.)
            // whereas readRecords().sumOf() would double-count overlapping data.
            val response = c.aggregate(
                AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(start, end),
                )
            )
            (response[StepsRecord.COUNT_TOTAL] ?: 0L).toInt()
        } catch (e: Exception) {
            0
        }
    }

    suspend fun getSleep(date: LocalDate): SleepResult = withContext(Dispatchers.IO) {
        val c = client ?: return@withContext SleepResult(0, emptyList())
        val zone = ZoneId.systemDefault()
        // Capture the night leading into `date` (noon prev day → noon that day)
        val start = date.minusDays(1).atTime(12, 0).atZone(zone).toInstant()
        val end = date.atTime(12, 0).atZone(zone).toInstant()
        try {
            val records = c.readRecords(
                ReadRecordsRequest(SleepSessionRecord::class, TimeRangeFilter.between(start, end))
            ).records
            val totalMinutes = records.sumOf { session ->
                (session.endTime.epochSecond - session.startTime.epochSecond) / 60
            }.toInt()
            val stages = records.flatMap { session ->
                session.stages.map { stage ->
                    SleepStage(
                        stage = stageName(stage.stage),
                        durationMinutes = ((stage.endTime.epochSecond - stage.startTime.epochSecond) / 60).toInt()
                    )
                }
            }
            SleepResult(totalMinutes, stages)
        } catch (e: Exception) {
            SleepResult(0, emptyList())
        }
    }

    private fun stageName(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE       -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING    -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED  -> "out_of_bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT       -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP        -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM         -> "rem"
        else                                      -> "unknown"
    }

    data class SleepResult(val durationMinutes: Int, val stages: List<SleepStage>)
    data class SleepStage(val stage: String, val durationMinutes: Int)
}
