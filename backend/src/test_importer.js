require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('./services/db');
const { processCSVImport } = require('./services/importer');

async function testImport() {
  console.log('--- START IMPORT VERIFICATION ---');

  try {
    // 1. Find the default group seeded earlier
    const group = await prisma.group.findFirst({
      where: { name: 'Flat 2B Shared Expenses' },
      include: {
        members: {
          include: { user: true }
        }
      }
    });

    if (!group) {
      console.error('Error: Default group not found. Did you run the seed script?');
      process.exit(1);
    }

    console.log(`Using group: ${group.name} (${group.id})`);
    console.log(`Members count: ${group.members.length}`);

    // 2. Read the CSV file
    const csvPath = path.join(__dirname, '../../expenses_export.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`Error: CSV file not found at ${csvPath}`);
      process.exit(1);
    }

    const csvText = fs.readFileSync(csvPath, 'utf8');
    console.log(`Loaded CSV size: ${csvText.length} bytes`);

    // 3. Create a test ImportSession
    const session = await prisma.importSession.create({
      data: {
        groupId: group.id,
        filename: 'expenses_export.csv',
        uploadedById: group.createdById, // Aisha
        status: 'PENDING'
      }
    });

    console.log(`Created Import Session: ${session.id}`);

    // 4. Run the CSV Import pipeline
    console.log('Running processCSVImport...');
    const resultSession = await processCSVImport(session.id, csvText);

    console.log('\n--- SESSION STATISTICS ---');
    console.log(`Status: ${resultSession.status}`);
    console.log(`Total Rows: ${resultSession.totalRows}`);
    console.log(`Imported (Auto-fixed/Safe) Rows: ${resultSession.importedRows}`);
    console.log(`Skipped Rows: ${resultSession.skippedRows}`);
    console.log(`Held (Require Review) Rows: ${resultSession.heldRows}`);

    // 5. Fetch and print the detected anomalies
    const anomalies = await prisma.importAnomaly.findMany({
      where: { sessionId: session.id },
      orderBy: { rowNumber: 'asc' }
    });

    console.log(`\n--- DETECTED ANOMALIES (${anomalies.length} found) ---`);
    anomalies.forEach((anom) => {
      console.log(`Row ${anom.rowNumber}: [${anom.code}] - ${anom.action} - ${anom.description}`);
    });

    console.log('\n--- VERIFICATION COMPLETED SUCCESSFULY ---');
  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testImport();
