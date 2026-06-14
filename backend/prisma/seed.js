const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create Users
  const usersData = [
    { name: 'Aisha', username: 'aisha', email: 'aisha@example.com' },
    { name: 'Rohan', username: 'rohan', email: 'rohan@example.com' },
    { name: 'Priya', username: 'priya', email: 'priya@example.com' },
    { name: 'Meera', username: 'meera', email: 'meera@example.com' },
    { name: 'Dev', username: 'dev', email: 'dev@example.com' },
    { name: 'Sam', username: 'sam', email: 'sam@example.com' },
  ];

  const seededUsers = {};
  const passwordHash = await bcrypt.hash('password123', 10);

  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {
        name: u.name,
        email: u.email,
        passwordHash,
      },
      create: {
        name: u.name,
        username: u.username,
        email: u.email,
        passwordHash,
      },
    });
    seededUsers[u.name] = user;
    console.log(`Seeded user: ${user.name}`);
  }

  // Create Default Group
  const defaultGroupName = 'Flat 2B Shared Expenses';
  const group = await prisma.group.findFirst({
    where: { name: defaultGroupName },
  });

  let groupRecord;
  if (!group) {
    groupRecord = await prisma.group.create({
      data: {
        name: defaultGroupName,
        description: 'Shared expenses for our flatmates.',
        createdById: seededUsers['Aisha'].id,
      },
    });
    console.log(`Created default group: ${defaultGroupName}`);
  } else {
    groupRecord = group;
    console.log(`Found existing default group: ${defaultGroupName}`);
  }

  // Define Group Memberships with timelines
  // Aisha: Joined Feb 1, 2026
  // Rohan: Joined Feb 1, 2026
  // Priya: Joined Feb 1, 2026
  // Meera: Joined Feb 1, 2026, Left Mar 31, 2026
  // Dev: Joined Feb 8, 2026, Left Mar 14, 2026
  // Sam: Joined Apr 8, 2026
  const memberships = [
    { name: 'Aisha', role: 'ADMIN', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { name: 'Rohan', role: 'MEMBER', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { name: 'Priya', role: 'MEMBER', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { name: 'Meera', role: 'MEMBER', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: new Date('2026-03-31T23:59:59Z') },
    { name: 'Dev', role: 'MEMBER', joinedAt: new Date('2026-02-08T00:00:00Z'), leftAt: new Date('2026-03-14T23:59:59Z') },
    { name: 'Sam', role: 'MEMBER', joinedAt: new Date('2026-04-08T00:00:00Z'), leftAt: null },
  ];

  for (const m of memberships) {
    const user = seededUsers[m.name];
    await prisma.groupMember.upsert({
      where: {
        groupId_userId: {
          groupId: groupRecord.id,
          userId: user.id,
        },
      },
      update: {
        role: m.role,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
      },
      create: {
        groupId: groupRecord.id,
        userId: user.id,
        role: m.role,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
      },
    });
    console.log(`Set membership for ${m.name}: joined ${m.joinedAt.toISOString().slice(0, 10)}${m.leftAt ? `, left ${m.leftAt.toISOString().slice(0, 10)}` : ''}`);
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
