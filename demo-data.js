/* Safe sample dataset used only while DEMO_MODE is true in config.js. */
(function () {
  'use strict';

  var taskDefs = [
    {
      tab: 'MARs Registration', title: 'MARs Status of Mentees', deadline: '5 September',
      label: 'MARs Registration', options: ['Registered', 'Pending', 'Not Registered']
    },
    {
      tab: 'DOC Verification', title: 'Document Verification', deadline: '8 September',
      label: 'Verification Status', options: ['Verified', 'Pending', 'Correction Required']
    },
    {
      tab: 'Accenture Registration', title: 'Accenture Drive Registration', deadline: '10 September',
      label: 'Registration Status', options: ['Registered', 'Pending', 'Not Interested']
    },
    {
      tab: 'Cognizant Test Status', title: 'Cognizant Test Status', deadline: '12 September',
      label: 'Taken/Not-Taken', options: ['Taken', 'Not-Taken', 'Scheduled']
    },
    {
      tab: 'DevOps Top Students', title: 'DevOps Top Students', deadline: '',
      label: 'Placement Status', options: ['Placed', 'In Progress', 'Not Started']
    }
  ];

  var faculty = [
    { name: 'Shridhar Pandey', uid: '34582' },
    { name: 'Dr. Gursharan Singh', uid: '16967' },
    { name: 'Dr. Alok Misra', uid: '31011' },
    { name: 'Priyanka Gupta', uid: '21789' }
  ];

  var students = [
    'Aarav Sharma', 'Ananya Verma', 'Arjun Mehta', 'Diya Kapoor',
    'Ishaan Singh', 'Kavya Nair', 'Rohan Gupta', 'Sara Khan',
    'Vivaan Joshi', 'Meera Patel', 'Aditya Rao', 'Nisha Yadav'
  ];

  var doneWords = /registered|verified|taken|placed/i;
  var rows = [];
  var rowNumber = 2;

  taskDefs.forEach(function (task, taskIndex) {
    students.forEach(function (student, studentIndex) {
      var owner = faculty[(studentIndex + taskIndex) % faculty.length];
      var optionIndex = (studentIndex + taskIndex * 2) % task.options.length;
      var value = task.options[optionIndex];
      rows.push({
        tab: task.tab,
        row: rowNumber++,
        reg: '126' + String(1001 + studentIndex),
        student: student,
        owner: owner.name,
        ownerId: owner.uid,
        inherited: studentIndex % 6 === 5,
        statuses: [{ label: task.label, value: value, done: doneWords.test(value) }],
        remarks: [{ label: 'Mentor Remarks', value: studentIndex % 4 === 0 ? 'Follow up this week' : '' }],
        info: [
          { label: 'Programme', value: studentIndex % 2 ? 'B.Tech CSE' : 'B.Tech CSE (DevOps)' },
          { label: 'Section', value: 'K' + String(24 + (studentIndex % 3)) }
        ],
        private: []
      });
    });
  });

  window.PORTAL_DEMO_DATA = {
    ok: true,
    role: 'MASTER',
    email: 'prototype@lpu.in',
    name: 'Prototype Administrator',
    uid: 'DEMO',
    picture: '',
    board: taskDefs.slice(0, 4).map(function (task) {
      return {
        tab: task.tab,
        title: task.title,
        deadline: task.deadline,
        note: 'Review assigned students and update the latest status.',
        url: ''
      };
    }),
    tasks: taskDefs.map(function (task) {
      return {
        tab: task.tab,
        title: task.title,
        deadline: task.deadline,
        link: '',
        headerRow: 1,
        statuses: [{ label: task.label, options: task.options }],
        rowsForMe: students.length,
        kind: 'student',
        itemLabel: 'Student',
        inheritedOwners: 2
      };
    }),
    rows: rows,
    skipped: [],
    unmatched: [],
    onlyTab: '',
    hasDetail: true,
    generatedAt: new Date().toISOString()
  };
})();
