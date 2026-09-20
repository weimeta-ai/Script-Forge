// =============================================================================
// 历史数据回填脚本：重新解析 script_versions.scoreDetails.report，回填 title/score/grade
// -----------------------------------------------------------------------------
// 背景：report-extract.ts 解析逻辑鲁棒化后，历史已跑完但 score/grade/title 为空的
// 报告可重新解析回填，无需用户重跑分析。
//
// 用法：
//   yarn tsx src/scripts/backfill-score-extract.ts          # 全量回填
//   yarn tsx src/scripts/backfill-score-extract.ts --dry    # 试跑，只统计不写入
//
// 范围：仅回填 score/grade/title 缺失的字段，已有值不覆盖（避免把正确值改掉）。
// =============================================================================

import { eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { scriptVersions, type ScoreDetails } from '../db/schema'
import {
	extractTitleFromMarkdown,
	extractScoreFromMarkdown,
} from '../lib/report-extract'
import { logger } from '../logger'

async function main() {
	const dryRun = process.argv.includes('--dry')

	logger.info(
		{ dryRun },
		'🌱 开始回填 script_versions.scoreDetails 的 title/score/grade...',
	)

	// 拉所有有 scoreDetails 的版本（report 在 scoreDetails.report 里）
	const rows = await db
		.select({
			id: scriptVersions.id,
			scoreDetails: scriptVersions.scoreDetails,
		})
		.from(scriptVersions)
		.where(isNotNull(scriptVersions.scoreDetails))

	logger.info({ total: rows.length }, '扫描到带 scoreDetails 的版本数')

	let updated = 0
	let skipped = 0
	let failed = 0

	for (const row of rows) {
		const sd = row.scoreDetails as ScoreDetails | null
		if (!sd || !sd.report) {
			skipped++
			continue
		}

		// 判断哪些字段缺失（只回填缺失的，已有值不覆盖）
		const needTitle = !sd.title || sd.title === '未命名剧本'
		const needScore = sd.score === undefined || sd.score === null
		const needGrade = sd.grade === undefined || sd.grade === null

		if (!needTitle && !needScore && !needGrade) {
			skipped++
			continue
		}

		// 重新解析
		const title = extractTitleFromMarkdown(sd.report)
		const scoreInfo = extractScoreFromMarkdown(sd.report)

		const newScoreDetails: ScoreDetails = {
			...sd,
			title: needTitle ? title : sd.title,
			score: needScore ? scoreInfo?.score : sd.score,
			grade: needGrade ? scoreInfo?.grade : sd.grade,
		}

		if (dryRun) {
			logger.info(
				{
					id: row.id,
					oldTitle: sd.title,
					newTitle: newScoreDetails.title,
					oldScore: sd.score,
					newScore: newScoreDetails.score,
					oldGrade: sd.grade,
					newGrade: newScoreDetails.grade,
				},
				'[dry-run] 将更新',
			)
			updated++
			continue
		}

		try {
			await db
				.update(scriptVersions)
				.set({ scoreDetails: newScoreDetails })
				.where(eq(scriptVersions.id, row.id))
			updated++
		} catch (e) {
			logger.error({ id: row.id, err: e }, '更新失败')
			failed++
		}
	}

	logger.info('----------------------------------------')
	logger.info({ updated, skipped, failed, dryRun }, '回填完成')
	logger.info('----------------------------------------')

	process.exit(0)
}

main().catch((err) => {
	logger.error({ err }, '❌ backfill-score-extract 执行失败')
	process.exit(1)
})
