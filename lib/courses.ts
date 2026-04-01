import { query, queryOne } from '@/lib/db';

type UpsertCourseInput = {
  code: string;
  name: string;
  teacherId: string;
  section: string | null;
  courseProgram: string | null;
  yearLevel: number | null;
  academicYear: string | null;
  semester: number | null;
};

export async function upsertCourseAssignment(input: UpsertCourseInput) {
  const result: any = await query(
    `INSERT INTO courses (code, name, teacher_id, section, course_program, year_level, academic_year, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       name = VALUES(name),
       teacher_id = VALUES(teacher_id),
       section = VALUES(section),
       course_program = VALUES(course_program),
       year_level = VALUES(year_level),
       academic_year = VALUES(academic_year),
       semester = VALUES(semester)`,
    [
      input.code,
      input.name,
      input.teacherId,
      input.section,
      input.courseProgram,
      input.yearLevel,
      input.academicYear,
      input.semester,
    ]
  );

  const id = Number(result?.insertId || 0);
  if (id > 0) {
    return {
      id,
      created: Number(result?.affectedRows || 0) === 1,
    };
  }

  // Defensive fallback for legacy drivers/engines that do not expose insertId on duplicate updates.
  const existing: any = await queryOne('SELECT id FROM courses WHERE code = ? LIMIT 1', [input.code]);
  if (!existing?.id) {
    throw new Error(`Failed to resolve course assignment for code ${input.code}`);
  }

  return { id: Number(existing.id), created: false };
}
