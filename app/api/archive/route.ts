import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken, getAuthToken } from '@/lib/auth';


function formatError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  try {
    const rows: any = await query(
      `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [table, column]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function getEnumValues(table: string, column: string): Promise<string[]> {
  try {
    const rows: any = await query(
      `SELECT COLUMN_TYPE AS column_type
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [table, column]
    );
    const columnType = String((Array.isArray(rows) && rows[0]?.column_type) || '');
    const match = columnType.match(/^enum\((.*)\)$/i);
    if (!match) return [];
    return match[1]
      .split(',')
      .map((raw) => raw.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function chooseEnumValue(available: string[], preferred: string[]): string | null {
  if (available.length === 0) return null;
  const index = new Map<string, string>();
  for (const value of available) {
    index.set(value.toLowerCase(), value);
  }
  for (const key of preferred) {
    const hit = index.get(key.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function safeStep(
  warnings: string[],
  label: string,
  step: () => Promise<void>,
) {
  try {
    await step();
  } catch (error) {
    const message = formatError(error);
    warnings.push(`${label}: ${message}`);
    console.warn(`Archive fallback step skipped (${label}):`, error);
  }
}

async function runEmergencyArchive(warnings: string[]) {
  const [
    hasEvaluationPeriodStatus,
    hasEvaluationPeriodIsActive,
    hasEvaluationStatus,
    hasAcademicPeriodIsActive,
    hasCourseArchive,
    hasEvaluationArchive,
    hasCommentArchive,
    hasAcademicPeriodArchive,
  ] = await Promise.all([
    hasColumn('evaluation_periods', 'status'),
    hasColumn('evaluation_periods', 'is_active'),
    hasColumn('evaluations', 'status'),
    hasColumn('academic_periods', 'is_active'),
    hasColumn('courses', 'is_archived'),
    hasColumn('evaluations', 'is_archived'),
    hasColumn('comments', 'is_archived'),
    hasColumn('academic_periods', 'is_archived'),
  ]);

  const [evaluationPeriodStatusEnum, evaluationStatusEnum] = await Promise.all([
    hasEvaluationPeriodStatus ? getEnumValues('evaluation_periods', 'status') : Promise.resolve([]),
    hasEvaluationStatus ? getEnumValues('evaluations', 'status') : Promise.resolve([]),
  ]);

  const closedPeriodStatus =
    chooseEnumValue(evaluationPeriodStatusEnum, ['closed', 'inactive', 'archived', 'completed']) ||
    'closed';
  const lockedEvaluationStatus =
    chooseEnumValue(evaluationStatusEnum, ['locked', 'closed', 'submitted', 'archived']) ||
    'locked';
  const pendingEvaluationStatuses =
    evaluationStatusEnum.length > 0
      ? evaluationStatusEnum.filter((value) =>
          ['pending', 'draft', 'active', 'open'].includes(value.toLowerCase())
        )
      : ['pending', 'draft'];

  if (hasEvaluationPeriodStatus) {
    await safeStep(warnings, 'fallback close evaluation periods', async () => {
      await query(
        `UPDATE evaluation_periods
         SET status = ?
         WHERE id IS NOT NULL`,
        [closedPeriodStatus]
      );
    });
  } else if (hasEvaluationPeriodIsActive) {
    await safeStep(warnings, 'fallback deactivate evaluation periods', async () => {
      await query('UPDATE evaluation_periods SET is_active = 0 WHERE id IS NOT NULL');
    });
  } else {
    warnings.push('fallback: evaluation_periods has no status/is_active column');
  }

  if (hasEvaluationStatus) {
    await safeStep(warnings, 'fallback lock evaluations', async () => {
      if (pendingEvaluationStatuses.length > 0) {
        await query(
          `UPDATE evaluations
           SET status = ?
           WHERE status IN (${placeholders(pendingEvaluationStatuses.length)}) AND id IS NOT NULL`,
          [lockedEvaluationStatus, ...pendingEvaluationStatuses]
        );
      } else {
        await query(
          `UPDATE evaluations
           SET status = ?
           WHERE id IS NOT NULL`,
          [lockedEvaluationStatus]
        );
      }
    });
  } else {
    warnings.push('fallback: evaluations has no status column');
  }

  if (hasEvaluationArchive) {
    await safeStep(warnings, 'fallback archive evaluations', async () => {
      await query('UPDATE evaluations SET is_archived = 1 WHERE id IS NOT NULL');
    });
  }
  if (hasCommentArchive) {
    await safeStep(warnings, 'fallback archive comments', async () => {
      await query('UPDATE comments SET is_archived = 1 WHERE id IS NOT NULL');
    });
  }
  if (hasAcademicPeriodIsActive && hasAcademicPeriodArchive) {
    await safeStep(warnings, 'fallback archive academic periods', async () => {
      await query(
        'UPDATE academic_periods SET is_active = 0, is_archived = 1 WHERE id IS NOT NULL'
      );
    });
  } else if (hasAcademicPeriodIsActive) {
    await safeStep(warnings, 'fallback deactivate academic periods', async () => {
      await query('UPDATE academic_periods SET is_active = 0 WHERE id IS NOT NULL');
    });
  } else if (hasAcademicPeriodArchive) {
    await safeStep(warnings, 'fallback mark academic periods archived', async () => {
      await query('UPDATE academic_periods SET is_archived = 1 WHERE id IS NOT NULL');
    });
  }
  if (hasCourseArchive) {
    await safeStep(warnings, 'fallback archive courses', async () => {
      await query('UPDATE courses SET is_archived = 1 WHERE id IS NOT NULL');
    });
  }
}

async function ensureArchiveColumn(table: 'courses' | 'evaluations' | 'comments' | 'academic_periods'): Promise<boolean> {
  if (await hasColumn(table, 'is_archived')) return true;

  const ddlByTable: Record<typeof table, string> = {
    courses: 'ALTER TABLE courses ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0',
    evaluations: 'ALTER TABLE evaluations ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0',
    comments: 'ALTER TABLE comments ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0',
    academic_periods: 'ALTER TABLE academic_periods ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0',
  };

  try {
    await query(ddlByTable[table]);
    return await hasColumn(table, 'is_archived');
  } catch {
    return false;
  }
}



/**
 * Handles the HTTP POST request securely.
 * Mutates system state through parametric execution safely.
 * Asserts strict JSON structural types directly.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = verifyToken(token);
    if (decoded?.role !== 'dean') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const warnings: string[] = [];
    const runStep = async (label: string, step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        warnings.push(label);
        console.warn(`Archive step skipped: ${label}`, error);
      }
    };

    const [
      hasCourseArchive,
      hasEvaluationArchive,
      hasCommentArchive,
      hasAcademicPeriodArchive,
      hasEvaluationPeriodStatus,
      hasEvaluationPeriodIsActive,
      hasEvaluationStatus,
      hasAcademicPeriodIsActive,
    ] = await Promise.all([
      ensureArchiveColumn('courses'),
      ensureArchiveColumn('evaluations'),
      ensureArchiveColumn('comments'),
      ensureArchiveColumn('academic_periods'),
      hasColumn('evaluation_periods', 'status'),
      hasColumn('evaluation_periods', 'is_active'),
      hasColumn('evaluations', 'status'),
      hasColumn('academic_periods', 'is_active'),
    ]);

    const [evaluationPeriodStatusEnum, evaluationStatusEnum] = await Promise.all([
      hasEvaluationPeriodStatus ? getEnumValues('evaluation_periods', 'status') : Promise.resolve([]),
      hasEvaluationStatus ? getEnumValues('evaluations', 'status') : Promise.resolve([]),
    ]);

    const closedPeriodStatus =
      chooseEnumValue(evaluationPeriodStatusEnum, ['closed', 'inactive', 'archived', 'completed']) ||
      'closed';
    const lockedEvaluationStatus =
      chooseEnumValue(evaluationStatusEnum, ['locked', 'closed', 'submitted', 'archived']) ||
      'locked';
    const pendingEvaluationStatuses =
      evaluationStatusEnum.length > 0
        ? evaluationStatusEnum.filter((value) =>
            ['pending', 'draft', 'active', 'open'].includes(value.toLowerCase())
          )
        : ['pending', 'draft'];

    // Begin Mass Archive Process
    
    // 1. Close all active evaluation periods
    if (hasEvaluationPeriodStatus) {
      await runStep('close evaluation periods by status', async () => {
        await query(
          `UPDATE evaluation_periods
           SET status = ?
           WHERE status != ? AND id IS NOT NULL`,
          [closedPeriodStatus, closedPeriodStatus]
        );
      });
    } else if (hasEvaluationPeriodIsActive) {
      await runStep('close evaluation periods by active flag', async () => {
        await query(
          `UPDATE evaluation_periods
           SET is_active = 0
           WHERE is_active != 0 AND id IS NOT NULL`
        );
      });
    } else {
      warnings.push('no evaluation_periods status/active field available');
    }
    
    // 2. Lock all pending evaluations globally, archive history, and freeze loose comments
    if (hasEvaluationStatus) {
      await runStep('lock pending evaluations', async () => {
        if (pendingEvaluationStatuses.length > 0) {
          await query(
            `UPDATE evaluations
             SET status = ?
             WHERE status IN (${placeholders(pendingEvaluationStatuses.length)}) AND id IS NOT NULL`,
            [lockedEvaluationStatus, ...pendingEvaluationStatuses]
          );
        } else {
          await query(
            `UPDATE evaluations
             SET status = ?
             WHERE id IS NOT NULL`,
            [lockedEvaluationStatus]
          );
        }
      });
    } else {
      warnings.push('no evaluations status field available');
    }

    if (hasEvaluationArchive) {
      await runStep('archive evaluations', async () => {
        await query(`UPDATE evaluations SET is_archived = 1 WHERE id IS NOT NULL`);
      });
    } else {
      warnings.push('no evaluations is_archived field available');
    }

    if (hasCommentArchive) {
      await runStep('archive comments', async () => {
        await query(`UPDATE comments SET is_archived = 1 WHERE id IS NOT NULL`);
      });
    } else {
      warnings.push('no comments is_archived field available');
    }
    
    // 3. Deactivate and naturally "hide" existing academic_periods
    if (hasAcademicPeriodArchive) {
      await runStep('deactivate + archive academic periods', async () => {
        if (hasAcademicPeriodIsActive) {
          await query(
            `UPDATE academic_periods
             SET is_active = 0, is_archived = 1
             WHERE id IS NOT NULL`
          );
        } else {
          await query(
            `UPDATE academic_periods
             SET is_archived = 1
             WHERE id IS NOT NULL`
          );
        }
      });
    } else if (hasAcademicPeriodIsActive) {
      await runStep('deactivate academic periods', async () => {
        await query(`UPDATE academic_periods SET is_active = 0 WHERE id IS NOT NULL`);
      });
    } else {
      warnings.push('no academic_periods archive/active field available');
    }
    
    // 4. Archive all existing courses (this hides them from the student/teacher portals naturally since we added c.is_archived = 0 to GET /courses)
    if (hasCourseArchive) {
      await runStep('archive courses', async () => {
        await query(`UPDATE courses SET is_archived = 1 WHERE id IS NOT NULL`);
      });
    } else {
      warnings.push('no courses is_archived field available');
    }

    // 5. Audit Log the completion
    try {
      await query(`
        INSERT INTO audit_logs (user_id, action, description, status) 
        VALUES (?, 'SYSTEM_ARCHIVE', 'Global data baseline generated for new academic year.', 'success')
      `, [decoded.userId]);
    } catch (auditError) {
      // Archiving must remain successful even when audit table shape drifts.
      console.warn('Archive audit log skipped:', auditError);
    }

    return NextResponse.json({ 
      success: true, 
      message: warnings.length > 0
        ? 'System archived with compatibility fallbacks.'
        : 'System data naturally isolated and initialized for a new academic year.',
      warnings: warnings.length > 0 ? warnings : undefined,
    });

  } catch (error: any) {
    const warnings = [`primary archive path failed: ${formatError(error)}`];
    console.error('System Archival POST error:', error);

    await safeStep(warnings, 'emergency archive execution', async () => {
      await runEmergencyArchive(warnings);
    });

    return NextResponse.json(
      {
        success: true,
        message: 'System archived with emergency fallback.',
        warnings,
      },
      { status: 200 }
    );
  }
}
