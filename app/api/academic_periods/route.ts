import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { verifyToken, getAuthToken } from '@/lib/auth';


function normalizeSemesterTokens(raw: any) {
  const text = String(raw ?? '').trim();
  const lower = text.toLowerCase();

  let semesterNum: number | null = null;
  if (lower === '1' || lower === '1st' || lower === '1st semester') {
    semesterNum = 1;
  } else if (lower === '2' || lower === '2nd' || lower === '2nd semester') {
    semesterNum = 2;
  } else if (lower === '3' || lower === '3rd' || lower === '3rd semester' || lower === 'summer') {
    semesterNum = 3;
  } else {
    const parsed = Number.parseInt(text, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 3) {
      semesterNum = parsed;
    }
  }

  const labels = new Set<string>();
  if (text) labels.add(text);
  if (semesterNum === 1) {
    labels.add('1');
    labels.add('1st Semester');
  } else if (semesterNum === 2) {
    labels.add('2');
    labels.add('2nd Semester');
  } else if (semesterNum === 3) {
    labels.add('3');
    labels.add('Summer');
    labels.add('3rd Semester');
  }

  const [s1 = '', s2 = '', s3 = ''] = Array.from(labels);
  return { s1, s2, s3 };
}



/**
 * Handles the HTTP GET request securely.
 * Verifies the authorization bearer token natively via abstract logic.
 * Prevents access if user does not match the scoped role mapping.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded: any = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // only dean can access
    if (decoded.role !== 'dean') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const periods: any = await query('SELECT * FROM academic_periods ORDER BY start_date DESC');
    return NextResponse.json({ success: true, periods });
  } catch (error) {
    console.error('Academic periods GET error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
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
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded: any = verifyToken(token);
    if (decoded?.role !== 'dean') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, academic_year, semester, start_date, end_date, is_active } = body;
    if (!name || !academic_year || !semester || !start_date || !end_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // if is_active is true, deactivate others and close their evaluation periods
    if (is_active) {
      // Find the currently active academic period before deactivating
      const oldActive: any = await queryOne('SELECT id FROM academic_periods WHERE is_active = TRUE');
      await query('UPDATE academic_periods SET is_active = FALSE');

      // Close evaluation periods and lock pending evaluations from the old academic period
      if (oldActive) {
        const openPeriods: any = await query(
          `SELECT id FROM evaluation_periods WHERE academic_period_id = ? AND status != 'closed'`,
          [oldActive.id]
        );
        for (const ep of (openPeriods || [])) {
          await query(`UPDATE evaluation_periods SET status = 'closed' WHERE id = ?`, [ep.id]);
          await query(
            `UPDATE evaluations SET status = 'locked' WHERE period_id = ? AND status = 'pending'`,
            [ep.id]
          );
        }
      }
    }

    const result: any = await query(
      `INSERT INTO academic_periods (name, academic_year, semester, start_date, end_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, academic_year, semester, start_date, end_date, is_active ? 1 : 0]
    );
    const inserted = await queryOne('SELECT * FROM academic_periods WHERE id = ?', [result.insertId]);
    return NextResponse.json({ success: true, period: inserted });
  } catch (error) {
    console.error('Academic periods POST error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}

/**
 * Handles the HTTP PATCH request securely.
 * Applies partial structural updates reliably over database.
 */
export async function PATCH(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded: any = verifyToken(token);
    if (decoded?.role !== 'dean') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    // build set clause
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return NextResponse.json({ success: true });
    }
    if (updates.is_active) {
      // Find the currently active academic period before deactivating
      const oldActive: any = await queryOne(
        'SELECT id FROM academic_periods WHERE is_active = TRUE AND id != ?',
        [id]
      );
      await query('UPDATE academic_periods SET is_active = FALSE');

      // Close evaluation periods and lock pending evaluations from the old academic period
      if (oldActive) {
        const openPeriods: any = await query(
          `SELECT id FROM evaluation_periods WHERE academic_period_id = ? AND status != 'closed'`,
          [oldActive.id]
        );
        for (const ep of (openPeriods || [])) {
          await query(`UPDATE evaluation_periods SET status = 'closed' WHERE id = ?`, [ep.id]);
          await query(
            `UPDATE evaluations SET status = 'locked' WHERE period_id = ? AND status = 'pending'`,
            [ep.id]
          );
        }
      }
    }

    if (updates.is_archived === 0) {
      const pToUnlock: any = await queryOne('SELECT * FROM academic_periods WHERE id = ?', [id]);
      if (pToUnlock) {
        await query('UPDATE courses SET is_archived = 0 WHERE academic_year = ? AND semester = ?', [pToUnlock.academic_year, pToUnlock.semester]);
        await query('UPDATE evaluation_periods SET status = \'active\' WHERE academic_period_id = ? AND status = \'closed\'', [id]);
        await query('UPDATE evaluations SET is_archived = 0 WHERE period_id IN (SELECT id FROM evaluation_periods WHERE academic_period_id = ?)', [id]);
        await query('UPDATE evaluations SET status = \'pending\' WHERE status = \'locked\' AND period_id IN (SELECT id FROM evaluation_periods WHERE academic_period_id = ?)', [id]);
        await query('UPDATE comments SET is_archived = 0 WHERE created_at >= ? AND created_at <= ?', [pToUnlock.start_date, pToUnlock.end_date]);
      }
    }

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (updates as any)[f]);
    values.push(id);
    await query(`UPDATE academic_periods SET ${sets} WHERE id = ?`, values);
    const updated = await queryOne('SELECT * FROM academic_periods WHERE id = ?', [id]);
    return NextResponse.json({ success: true, period: updated });
  } catch (error) {
    console.error('Academic periods PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}

/**
 * Handles the HTTP DELETE request securely.
 * Ensures isolated teardowns leveraging foreign cascaded keys securely.
 */
export async function DELETE(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded: any = verifyToken(token);
    if (decoded?.role !== 'dean') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    const targetPeriod: any = await queryOne('SELECT * FROM academic_periods WHERE id = ?', [id]);
    if (!targetPeriod) {
      return NextResponse.json({ error: 'Academic period not found' }, { status: 404 });
    }

    const { s1: semToken1, s2: semToken2, s3: semToken3 } = normalizeSemesterTokens(targetPeriod.semester);

    // Deep cascade: Purge anonymous textual feedbacks submitted during this specific academic timeframe
    await query(
      'DELETE FROM comments WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?', 
      [targetPeriod.start_date, targetPeriod.end_date]
    );

    // Deep cascade: Nuke active enrollments attached to courses mapped under this academic semester
    await query(
      `DELETE FROM course_enrollments
       WHERE course_id IN (
         SELECT id FROM courses
         WHERE academic_year = ?
           AND CAST(semester AS CHAR) IN (?, ?, ?)
       )`,
      [targetPeriod.academic_year, semToken1, semToken2, semToken3]
    );

    // Deep cascade: Delete the physical courses generated and attached to this academic semantic frame
    await query(
      `DELETE FROM courses
       WHERE academic_year = ?
         AND CAST(semester AS CHAR) IN (?, ?, ?)`,
      [targetPeriod.academic_year, semToken1, semToken2, semToken3]
    );

    // Deep cascade: Delete all evaluation responses linked to evaluations inside this academic period
    await query(
      `DELETE er FROM evaluation_responses er
       JOIN evaluations e ON er.evaluation_id = e.id
       JOIN evaluation_periods ep ON e.period_id = ep.id
       WHERE ep.academic_period_id = ?
          OR (
            ep.academic_year = ?
            AND CAST(ep.semester AS CHAR) IN (?, ?, ?)
          )`,
      [id, targetPeriod.academic_year, semToken1, semToken2, semToken3]
    );

    // Deep cascade: Delete evaluations inside this academic period
    await query(
      `DELETE e FROM evaluations e
       JOIN evaluation_periods ep ON e.period_id = ep.id
       WHERE ep.academic_period_id = ?
          OR (
            ep.academic_year = ?
            AND CAST(ep.semester AS CHAR) IN (?, ?, ?)
          )`,
      [id, targetPeriod.academic_year, semToken1, semToken2, semToken3]
    );

    // Deep cascade: Delete evaluation periods linked to this academic period
    await query(
      `DELETE FROM evaluation_periods
       WHERE academic_period_id = ?
          OR (
            academic_year = ?
            AND CAST(semester AS CHAR) IN (?, ?, ?)
          )`,
      [id, targetPeriod.academic_year, semToken1, semToken2, semToken3]
    );

    // Finally, delete the academic period itself
    await query('DELETE FROM academic_periods WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Academic periods DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
