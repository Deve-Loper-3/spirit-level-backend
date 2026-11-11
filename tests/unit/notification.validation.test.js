const {
  listNotificationsQuerySchema: list,
  emptyQuerySchema: empty,
  notificationParamsSchema: params,
} = require('../../src/validators/notification.validation');
const { Messages } = require('../../src/constants/messages');

const issues = (result) => result.error.issues.map((i) => [i.path.join('.'), i.message]);

describe('list notifications query', () => {
  it('defaults to page 1, limit 20 and no unread filter', () => {
    expect(list.safeParse({}).data).toEqual({ page: 1, limit: 20 });
  });

  it('parses unread=true / false and paging', () => {
    expect(list.safeParse({ unread: 'true' }).data.unread).toBe(true);
    expect(list.safeParse({ unread: 'false' }).data.unread).toBe(false);
    expect(list.safeParse({ page: '2', limit: '5' }).data).toMatchObject({ page: 2, limit: 5 });
  });

  it('rejects other unread values, a bad page and unknown parameters', () => {
    expect(issues(list.safeParse({ unread: 'yes' }))).toEqual([
      ['unread', Messages.NOTIFICATION_UNREAD_INVALID],
    ]);
    expect(list.safeParse({ unread: 'TRUE' }).success).toBe(false);
    expect(list.safeParse({ page: '0' }).success).toBe(false);
    expect(list.safeParse({ limit: '101' }).success).toBe(false);
    expect(issues(list.safeParse({ type: 'x' }))).toContainEqual([
      '',
      Messages.ORDER_QUERY_UNKNOWN_FIELD,
    ]);
  });
});

describe('empty query and params', () => {
  it('endpoints without input reject any query parameter', () => {
    expect(empty.safeParse({}).success).toBe(true);
    expect(empty.safeParse({ page: '1' }).success).toBe(false);
  });

  it('the notification id must be a UUID', () => {
    expect(
      params.safeParse({ notificationId: '3f0e5f4e-8f3b-4c8a-9d52-1a2b3c4d5e6f' }).success,
    ).toBe(true);
    expect(issues(params.safeParse({ notificationId: 'x' }))).toEqual([
      ['notificationId', Messages.NOTIFICATION_ID_INVALID],
    ]);
  });
});
