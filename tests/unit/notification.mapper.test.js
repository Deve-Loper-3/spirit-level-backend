const { toNotificationResponse } = require('../../src/repositories/notification.mapper');

const row = {
  id: 'n1',
  type: 'CLASS_CANCELLED',
  title: 'Class cancelled',
  body: 'Your booking was cancelled.',
  data: { sessionId: 's1', classId: 'c1', startAt: '2026-12-01T06:00:00.000Z' },
  readAt: null,
  createdAt: new Date('2026-11-11T08:00:00.000Z'),
  userId: 'must-not-leak',
};

describe('toNotificationResponse', () => {
  it('returns the documented fields, ISO UTC, an explicit null readAt, and no user id', () => {
    expect(toNotificationResponse(row)).toEqual({
      id: 'n1',
      type: 'CLASS_CANCELLED',
      title: 'Class cancelled',
      body: 'Your booking was cancelled.',
      data: { sessionId: 's1', classId: 'c1', startAt: '2026-12-01T06:00:00.000Z' },
      readAt: null,
      createdAt: '2026-11-11T08:00:00.000Z',
    });
  });

  it('formats readAt when read and never leaves data undefined', () => {
    const out = toNotificationResponse({
      ...row,
      data: null,
      readAt: new Date('2026-11-12T09:00:00.000Z'),
    });
    expect(out.readAt).toBe('2026-11-12T09:00:00.000Z');
    expect(out.data).toEqual({});
  });
});
