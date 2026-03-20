import React from 'react';

interface StepAcademicPeriodProps {
  data: {
    academicYear: string;
    semester: string;
    startDate: string;
    endDate: string;
  };
  onChange: (field: string, value: string) => void;
}

const semesters = [
  { value: '1st Semester', label: '1st Semester' },
  { value: '2nd Semester', label: '2nd Semester' },
  { value: 'Summer', label: 'Summer' },
];

export const StepAcademicPeriod: React.FC<StepAcademicPeriodProps> = ({ data, onChange }) => (
  <div className="max-w-xl mx-auto p-8 bg-white rounded-lg shadow-md">
    <h2 className="text-2xl font-bold mb-6 text-center">Step 1: Academic Period</h2>
    <div className="mb-6">
      <div className="block text-lg font-semibold mb-1">Academic Year</div>
      <input
        type="text"
        className="w-full p-3 text-lg border rounded focus:outline-blue-500"
        placeholder="e.g. 2025–2026"
        value={data.academicYear}
        onChange={e => onChange('academicYear', e.target.value)}
      />
      <p className="text-gray-600 text-sm mt-1">Enter the academic year (e.g., 2025–2026).</p>
    </div>
    <div className="mb-6">
      <div className="block text-lg font-semibold mb-1">Semester</div>
      <select
        className="w-full p-3 text-lg border rounded focus:outline-blue-500"
        value={data.semester}
        onChange={e => onChange('semester', e.target.value)}
      >
        <option value="">Select Semester</option>
        {semesters.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <p className="text-gray-600 text-sm mt-1">Choose the semester for this academic period.</p>
    </div>
    <div className="mb-6">
      <div className="block text-lg font-semibold mb-1">Start Date</div>
      <input
        type="date"
        className="w-full p-3 text-lg border rounded focus:outline-blue-500"
        value={data.startDate}
        onChange={e => onChange('startDate', e.target.value)}
      />
      <p className="text-gray-600 text-sm mt-1">Select the start date of the academic period.</p>
    </div>
    <div className="mb-6">
      <div className="block text-lg font-semibold mb-1">End Date</div>
      <input
        type="date"
        className="w-full p-3 text-lg border rounded focus:outline-blue-500"
        value={data.endDate}
        onChange={e => onChange('endDate', e.target.value)}
      />
      <p className="text-gray-600 text-sm mt-1">Select the end date of the academic period.</p>
    </div>
  </div>
);

export default StepAcademicPeriod;
