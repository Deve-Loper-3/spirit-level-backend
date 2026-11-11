jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/repositories/notification.repository', () => ({
  listNotifications: jest.fn(),
  countUnread: jest.fn(),
  findOwnedNotification: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
}));

const repo = require('../../src/repositories/notification.repository');
const service = require('../../src/services/notification.service');

const NOW = new Date('2026-11-12T09:00:00.000Z');
const row = (overrides = {}) => ({
  id: 'n1',
  type: 'CLASS_CANCELLED',
  title: 'Class cancelled',
  body: 'Body',
  data: {},
  readAt: null,
  createdAt: new Date('2026-11-11T08:00:00.000Z'),
  ...overrides,
});

beforeEach(() => jest.resetAllMocks());

describe('listNotifications', () => {
  it('scopes to the caller, maps rows and builds the pagination envelope', async () => {
    repo.listNotifications.mockResolvedValue({ rows: [row()], total: 41 });
    const out = await service.listNotifications({
      userId: 'u1',
      query: { unread: true, page: 2, limit: 20 },
    });
    expect(repo.listNotifications).toHaveBeenCalledWith({
      userId: 'u1',
      unreadOnly: true,
      page: 2,
      limit: 20,
    });
    expect(out.data[0]).toMatchObject({ id: 'n1', readAt: null });
    expect(out.pagination).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
  });

  it('no unread filter means every notification', async () => {
    repo.listNotifications.mockResolvedValue({ rows: [], total: 0 });
    await service.listNotifications({ userId: 'u1', query: { page: 1, limit: 20 } });
    expect(repo.listNotifications.mock.calls[0][0].unreadOnly).toBe(false);
  });
});

describe('getUnreadCount', () => {
  it('counts only the caller rows', async () => {
    repo.countUnread.mockResolvedValue(4);
    expect(await service.getUnreadCount({ userId: 'u1' })).toEqual({ unreadCount: 4 });
    expect(repo.countUnread).toHaveBeenCalledWith('u1');
  });
});

describe('markNotificationRead', () => {
  it("marks the caller's unread row and returns it", async () => {
    repo.markRead.mockResolvedValue(1);
    repo.findOwnedNotification.mockResolvedValue(row({ readAt: NOW }));
    const out = await service.markNotificationRead({
      userId: 'u1',
      notificationId: 'n1',
      now: NOW,
    });
    expect(repo.markRead).toHaveBeenCalledWith('u1', 'n1', NOW);
    expect(repo.findOwnedNotification).toHaveBeenCalledWith('u1', 'n1');
    expect(out.readAt).toBe('2026-11-12T09:00:00.000Z');
  });

  it('is idempotent: an already-read row is returned with its first read time', async () => {
    repo.markRead.mockResolvedValue(0);
    repo.findOwnedNotification.mockResolvedValue(
      row({ readAt: new Date('2026-11-11T10:00:00.000Z') }),
    );
    const out = await service.markNotificationRead({
      userId: 'u1',
      notificationId: 'n1',
      now: NOW,
    });
    expect(out.readAt).toBe('2026-11-11T10:00:00.000Z');
  });

  it("somebody else's or a missing notification is 404 NOTIFICATION_NOT_FOUND", async () => {
    repo.markRead.mockResolvedValue(0);
    repo.findOwnedNotification.mockResolvedValue(null);
    await expect(
      service.markNotificationRead({ userId: 'u1', notificationId: 'other' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOTIFICATION_NOT_FOUND' });
  });
});

describe('markAllNotificationsRead', () => {
  it('marks the caller unread rows and reports how many', async () => {
    repo.markAllRead.mockResolvedValue(3);
    expect(await service.markAllNotificationsRead({ userId: 'u1', now: NOW })).toEqual({
      updatedCount: 3,
    });
    expect(repo.markAllRead).toHaveBeenCalledWith('u1', NOW);
  });

  it('nothing unread: updatedCount 0', async () => {
    repo.markAllRead.mockResolvedValue(0);
    expect((await service.markAllNotificationsRead({ userId: 'u1' })).updatedCount).toBe(0);
  });
});
