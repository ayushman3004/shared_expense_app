import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { 
  Upload, AlertTriangle, Check, ArrowLeft, 
  CheckCircle2
} from 'lucide-react';

interface Anomaly {
  id: string;
  code: string;
  description: string;
  action: string;
  resolution: string | null;
}

interface ImportRow {
  id: string;
  rowNumber: number;
  rawData: any;
  status: 'PENDING' | 'IMPORTED' | 'HELD' | 'REJECTED' | 'SKIPPED';
  anomalies: Anomaly[];
}

export default function ImportWizard() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  
  const [group, setGroup] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<ImportRow | null>(null);
  
  const [_loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  
  // Rate setting input state
  const [usdRate, setUsdRate] = useState('83.00');
  const [settingRate, setSettingRate] = useState(false);

  // Resolution form states
  const [resPayerId, setResPayerId] = useState('');
  const [resDate, setResDate] = useState('');
  const [resCurrency, setResCurrency] = useState('INR');
  const [resRecipientId, setResRecipientId] = useState('');
  const [resDecision, setResDecision] = useState<'KEEP' | 'REJECT' | 'SETTLEMENT' | 'REFUND'>('KEEP');
  
  // Splitting edit values: userId -> value string
  const [resSplits, setResSplits] = useState<Record<string, string>>({});
  
  const fetchGroup = async () => {
    if (!groupId) return;
    try {
      const data = await api.get(`/groups/${groupId}`);
      setGroup(data);
    } catch (err: any) {
      setError('Failed to load group details');
    }
  };

  const fetchSessionReport = async (sid: string) => {
    try {
      setLoading(true);
      const data = await api.get(`/imports/${sid}/report`);
      setSession(data);
      setRows(data.rows || []);
      if (data.usdToInr) {
        setUsdRate(String(data.usdToInr));
      }
      
      // Auto-select first HELD row
      const firstHeld = data.rows?.find((r: ImportRow) => r.status === 'HELD');
      if (firstHeld) {
        handleSelectRow(firstHeld);
      } else {
        setSelectedRow(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load import session');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroup();
  }, [groupId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !groupId) return;

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('file', file);

    try {
      const data = await api.postFormData('/imports/upload', formData);
      await fetchSessionReport(data.id);
    } catch (err: any) {
      setError(err.message || 'Failed to upload CSV file');
    } finally {
      setUploading(false);
    }
  };

  const handleSelectRow = (row: ImportRow) => {
    setSelectedRow(row);
    // Initialize resolution parameters based on row anomalies
    const raw = row.rawData;
    
    // Default Payer selection
    setResPayerId('');
    
    // Default Recipient selection (for settlements)
    setResRecipientId('');
    if (raw.description && (raw.description.toLowerCase().includes('paid back') || raw.description.toLowerCase().includes('deposit share'))) {
      // Try mapping recipient from split_with name
      const splitNames = raw.split_with ? raw.split_with.split(';').map((n: string) => n.trim().toLowerCase()) : [];
      if (splitNames.length === 1 && group) {
        const match = group.members.find((m: any) => m.user.name.toLowerCase() === splitNames[0] || m.user.username === splitNames[0]);
        if (match) setResRecipientId(match.userId);
      }
    }

    // Default Date selection
    setResDate('');
    
    // Default splits
    const initialSplits: Record<string, string> = {};
    if (raw.split_details) {
      // Parse percentages/shares from split details
      raw.split_details.split(';').forEach((item: string) => {
        const parts = item.trim().split(/\s+/);
        if (parts.length >= 2) {
          const valStr = parts.pop() || '';
          const name = parts.join(' ').toLowerCase();
          if (group) {
            const member = group.members.find((m: any) => m.user.name.toLowerCase() === name || m.user.username === name);
            if (member) {
              initialSplits[member.userId] = valStr;
            }
          }
        }
      });
    } else if (raw.split_with && group) {
      // Fill equal or base splits
      raw.split_with.split(';').forEach((name: string) => {
        const cleanName = name.trim().toLowerCase();
        const member = group.members.find((m: any) => m.user.name.toLowerCase() === cleanName || m.user.username === cleanName);
        if (member) {
          initialSplits[member.userId] = raw.split_type === 'percentage' ? '0%' : '1';
        }
      });
    }

    setResSplits(initialSplits);
    setResDecision('KEEP');
  };

  const handleInputChange = (userId: string, val: string) => {
    setResSplits((prev) => ({
      ...prev,
      [userId]: val
    }));
  };

  const handleApplyUsdRate = async () => {
    if (!session || !usdRate || isNaN(parseFloat(usdRate))) return;
    setSettingRate(true);
    try {
      await api.post(`/imports/${session.id}/rate`, { usdToInr: parseFloat(usdRate) });
      // Reload report
      await fetchSessionReport(session.id);
    } catch (err: any) {
      alert(err.message || 'Failed to update exchange rate');
    } finally {
      setSettingRate(false);
    }
  };

  const handleResolveAnomaly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !selectedRow) return;

    setError('');

    const resolutions: Record<string, any> = {};
    // Build resolutions payloads based on anomalies
    for (const anom of selectedRow.anomalies) {
      if (anom.code === 'PAYER_UNKNOWN' || anom.code === 'PAYER_MISSING') {
        if (!resPayerId) {
          setError('Please select a resolved payer from the list.');
          return;
        }
        resolutions[anom.code] = { userId: resPayerId };
      }
      else if (anom.code === 'DATE_AMBIGUOUS') {
        if (!resDate) {
          setError('Please specify the correct calendar date.');
          return;
        }
        resolutions[anom.code] = { date: resDate };
      }
      else if (anom.code === 'CURRENCY_MISSING') {
        resolutions[anom.code] = { currency: resCurrency };
      }
      else if (anom.code === 'SETTLEMENT_AS_EXPENSE') {
        if (resDecision === 'SETTLEMENT') {
          if (!resRecipientId) {
            setError('Please select who received the payment (Recipient).');
            return;
          }
          resolutions[anom.code] = { decision: 'SETTLEMENT', toUserId: resRecipientId };
        } else if (resDecision === 'REJECT') {
          resolutions[anom.code] = { decision: 'REJECT' };
        }
      }
      else if (anom.code === 'AMOUNT_NEGATIVE') {
        resolutions[anom.code] = { decision: resDecision === 'REFUND' ? 'REFUND' : 'REJECT' };
      }
      else if (anom.code === 'DUPLICATE_EXACT' || anom.code === 'DUPLICATE_CONFLICTING') {
        resolutions[anom.code] = { decision: resDecision }; // KEEP or REJECT
      }
      else if (anom.code === 'PERCENTAGE_INVALID_SUM') {
        // Build resolved splits percentage list
        const splitsData = group.members.map((m: any) => {
          let val = resSplits[m.userId] || '0%';
          if (!val.endsWith('%')) val = `${val}%`;
          return { name: m.user.name, rawValue: val };
        });
        
        // Sum validation
        const sum = splitsData.reduce((s: number, sp: any) => s + (parseFloat(sp.rawValue.replace('%', '')) || 0), 0);
        if (Math.abs(sum - 100) > 0.01) {
          setError(`Percentages must sum to exactly 100%. (Current sum: ${sum}%)`);
          return;
        }
        resolutions[anom.code] = { splits: splitsData };
      }
      else if (anom.code === 'MEMBERSHIP_VIOLATION' || anom.code === 'MEMBER_NOT_IN_GROUP') {
        // Filter out splits with active members only
        const splitsData = group.members
          .filter((m: any) => resSplits[m.userId] !== undefined)
          .map((m: any) => ({
            name: m.user.name,
            rawValue: resSplits[m.userId] || 'equal'
          }));
        
        resolutions[anom.code] = { splits: splitsData };
      }
    }

    // Determine row final decision
    let finalDecision = 'IMPORTED';
    if (resDecision === 'REJECT' || (selectedRow.anomalies.some(a => a.code === 'AMOUNT_NEGATIVE') && resDecision !== 'REFUND')) {
      finalDecision = 'REJECTED';
    }

    try {
      await api.post(`/imports/${session.id}/resolve/${selectedRow.id}`, {
        resolutions,
        decision: finalDecision
      });
      
      // Reload report and auto select next
      await fetchSessionReport(session.id);
    } catch (err: any) {
      setError(err.message || 'Failed to save resolution');
    }
  };

  const handleCommitImport = async () => {
    if (!session) return;
    if (!window.confirm('Are you sure you want to commit all resolved rows to the group database? This is an atomic transaction.')) return;
    
    setLoading(true);
    setError('');

    try {
      await api.post(`/imports/${session.id}/commit`, {});
      alert('Import completed successfully!');
      navigate(`/groups/${groupId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to commit import records');
      setLoading(false);
    }
  };

  if (!group) return <p style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>Loading group details...</p>;

  return (
    <div className="main-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to={`/groups/${groupId}`} style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
          <ArrowLeft size={12} /> Back to Group Dashboard
        </Link>
        <h1 style={{ fontSize: '2.25rem', margin: '0.5rem 0 0.25rem 0' }}>CSV Import Wizard</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Import bills from spreadsheet export into <b>{group.name}</b>.</p>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1.5rem', textAlign: 'left' }}>
          {error}
        </div>
      )}

      {/* PHASE 1: NO ACTIVE SESSION (UPLOAD FILE) */}
      {!session ? (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', padding: '3rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Upload Spreadsheet Export</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Select the `expenses_export.csv` file. Our pipeline will parse it and scan for anomalies.</p>
          </div>

          <label className="upload-zone">
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleFileUpload} 
              style={{ display: 'none' }} 
              disabled={uploading}
            />
            <Upload className="upload-icon" style={{ margin: '0 auto 1rem auto' }} />
            <h3>{uploading ? 'Processing file...' : 'Choose CSV File'}</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Only supports .csv files exactly as exported</p>
          </label>
        </div>
      ) : (
        /* PHASE 2: REVIEW ANOMALIES & COMMITTING */
        <div>
          {/* Steps tracker UI */}
          <div className="wizard-steps">
            <div className="wizard-step completed">
              <span className="step-num"><Check size={10} /></span>
              <span>1. Upload CSV</span>
            </div>
            <div className={`wizard-step ${session.heldRows > 0 ? 'active' : 'completed'}`}>
              <span className="step-num">{session.heldRows > 0 ? '2' : <Check size={10} />}</span>
              <span>2. Resolve Anomalies ({session.heldRows} remaining)</span>
            </div>
            <div className={`wizard-step ${session.heldRows === 0 ? 'active' : ''}`}>
              <span className="step-num">3</span>
              <span>3. Commit Import</span>
            </div>
          </div>

          {/* USD Exchange Rate Warning Panel */}
          {rows.some(r => r.anomalies.some(a => a.code === 'CURRENCY_USD')) && !session.usdToInr && (
            <div className="card" style={{ border: '1px solid var(--warning-border)', backgroundColor: 'var(--warning-bg)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <AlertTriangle style={{ color: 'var(--warning)' }} />
                <div>
                  <h4 style={{ color: 'var(--warning)', margin: 0 }}>USD Expenses Detected</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', margin: 0 }}>
                    Please enter the historical exchange rate (USD to INR) to convert Goa trip expenses.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem' }}>1 USD = </span>
                <input
                  type="number"
                  step="0.01"
                  className="form-input"
                  style={{ width: '80px', padding: '0.4rem' }}
                  value={usdRate}
                  onChange={(e) => setUsdRate(e.target.value)}
                  disabled={settingRate}
                />
                <span style={{ fontSize: '0.85rem' }}>INR</span>
                <button onClick={handleApplyUsdRate} className="btn btn-primary btn-sm" disabled={settingRate}>
                  {settingRate ? 'Saving...' : 'Apply Rate'}
                </button>
              </div>
            </div>
          )}

          {/* Split Panel Dashboard: Rows list on left, Resolution Form on right */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
            {/* Rows List (Left Column) */}
            <div style={{ flex: '1 1 480px', maxHeight: '650px', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Processed Rows ({rows.length})
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rows.map((row) => {
                  const isSelected = selectedRow?.id === row.id;
                  const isHeld = row.status === 'HELD';
                  const isImported = row.status === 'IMPORTED';
                  const isSkipped = row.status === 'SKIPPED';
                  const isRejected = row.status === 'REJECTED';

                  return (
                    <div
                      key={row.id}
                      onClick={() => handleSelectRow(row)}
                      className="card"
                      style={{
                        padding: '0.875rem 1.25rem',
                        marginBottom: 0,
                        cursor: 'pointer',
                        borderColor: isSelected ? 'var(--primary)' : isHeld ? 'var(--danger-border)' : 'var(--border-color)',
                        backgroundColor: isSelected ? 'var(--primary-glow)' : isHeld ? 'rgba(239, 68, 68, 0.02)' : 'var(--bg-card)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', width: '45px' }}>
                          Row {row.rowNumber}
                        </span>
                        <div>
                          <strong style={{ fontSize: '0.9rem' }}>{row.rawData.description || 'Imported Row'}</strong>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Payer: {row.rawData.paid_by || '(blank)'} | Amount: {row.rawData.currency || ''} {row.rawData.amount}
                          </p>
                        </div>
                      </div>

                      <div>
                        {isHeld && <span className="badge badge-danger">Held</span>}
                        {isImported && <span className="badge badge-success">Cleaned</span>}
                        {isSkipped && <span className="badge badge-warning">Skipped</span>}
                        {isRejected && <span className="badge badge-danger" style={{ opacity: 0.6 }}>Rejected</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Resolution Form (Right Column) */}
            <div style={{ flex: '1 1 440px', position: 'sticky', top: '90px' }}>
              {selectedRow ? (
                <div className="card" style={{ border: '1px solid var(--border-color)' }}>
                  <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <span>Resolve Row {selectedRow.rowNumber} Anomaly</span>
                    <span className="badge badge-danger">Review</span>
                  </h3>
                  
                  {/* Raw row values info */}
                  <div style={{ fontSize: '0.75rem', backgroundColor: 'var(--bg-input)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.25rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Raw Description:</span>
                      <span style={{ color: 'var(--text-primary)' }}>{selectedRow.rawData.description}</span>
                      <span style={{ color: 'var(--text-muted)' }}>Raw Payer:</span>
                      <span>{selectedRow.rawData.paid_by || '(blank)'}</span>
                      <span style={{ color: 'var(--text-muted)' }}>Raw Amount:</span>
                      <span>{selectedRow.rawData.currency} {selectedRow.rawData.amount}</span>
                      <span style={{ color: 'var(--text-muted)' }}>Raw Splits:</span>
                      <span>{selectedRow.rawData.split_with}</span>
                      {selectedRow.rawData.notes && (
                        <>
                          <span style={{ color: 'var(--text-muted)' }}>Raw Notes:</span>
                          <span style={{ fontStyle: 'italic', color: 'var(--warning)' }}>{selectedRow.rawData.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Flagged anomalies list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    {selectedRow.anomalies.map((anom) => (
                      <div key={anom.id} className="badge badge-danger" style={{ display: 'flex', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', textAlign: 'left', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                        <AlertTriangle size={12} />
                        <strong>{anom.code}:</strong> {anom.description}
                      </div>
                    ))}
                  </div>

                  {/* Resolution Input controls depending on code */}
                  <form onSubmit={handleResolveAnomaly}>
                    {/* 1. DUPLICATE_EXACT / DUPLICATE_CONFLICTING */}
                    {selectedRow.anomalies.some(a => a.code === 'DUPLICATE_EXACT' || a.code === 'DUPLICATE_CONFLICTING') && (
                      <div className="form-group">
                        <label className="form-label">Duplicate Row Resolution</label>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'KEEP' ? 'var(--primary-glow)' : 'transparent', borderColor: resDecision === 'KEEP' ? 'var(--primary)' : 'var(--border-color)' }}>
                            <input type="radio" name="dup" checked={resDecision === 'KEEP'} onChange={() => setResDecision('KEEP')} style={{ marginRight: '0.25rem' }} /> Keep Row
                          </label>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'REJECT' ? 'var(--danger-bg)' : 'transparent', borderColor: resDecision === 'REJECT' ? 'var(--danger)' : 'var(--border-color)' }}>
                            <input type="radio" name="dup" checked={resDecision === 'REJECT'} onChange={() => setResDecision('REJECT')} style={{ marginRight: '0.25rem' }} /> Reject Duplicate
                          </label>
                        </div>
                      </div>
                    )}

                    {/* 2. PAYER_UNKNOWN / PAYER_MISSING */}
                    {selectedRow.anomalies.some(a => a.code === 'PAYER_UNKNOWN' || a.code === 'PAYER_MISSING') && (
                      <div className="form-group">
                        <label className="form-label">Map Payer to Member</label>
                        <select className="form-input" value={resPayerId} onChange={(e) => setResPayerId(e.target.value)} required>
                          <option value="">Select group member...</option>
                          {group.members.map((m: any) => (
                            <option key={m.userId} value={m.userId}>{m.user.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 3. DATE_AMBIGUOUS */}
                    {selectedRow.anomalies.some(a => a.code === 'DATE_AMBIGUOUS') && (() => {
                      const slashMatch = selectedRow.rawData.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                      if (!slashMatch) return null;
                      const p1 = slashMatch[1];
                      const p2 = slashMatch[2];
                      const y = slashMatch[3];
                      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const d1Text = `${p1} ${months[parseInt(p2) - 1]} ${y}`;
                      const d2Text = `${p2} ${months[parseInt(p1) - 1]} ${y}`;
                      
                      const isoDate1 = `${y}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
                      const isoDate2 = `${y}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;

                      return (
                        <div className="form-group">
                          <label className="form-label">Select Correct Date</label>
                          <select className="form-input" value={resDate} onChange={(e) => setResDate(e.target.value)} required>
                            <option value="">Choose date...</option>
                            <option value={isoDate1}>{d1Text} (DD/MM/YYYY)</option>
                            <option value={isoDate2}>{d2Text} (MM/DD/YYYY)</option>
                          </select>
                        </div>
                      );
                    })()}

                    {/* 4. CURRENCY_MISSING */}
                    {selectedRow.anomalies.some(a => a.code === 'CURRENCY_MISSING') && (
                      <div className="form-group">
                        <label className="form-label">Select Currency</label>
                        <select className="form-input" value={resCurrency} onChange={(e) => setResCurrency(e.target.value)}>
                          <option value="INR">INR (₹)</option>
                          <option value="USD">USD ($)</option>
                        </select>
                      </div>
                    )}

                    {/* 5. SETTLEMENT_AS_EXPENSE */}
                    {selectedRow.anomalies.some(a => a.code === 'SETTLEMENT_AS_EXPENSE') && (
                      <div className="form-group">
                        <label className="form-label">Settle Payment Resolution</label>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'SETTLEMENT' ? 'var(--primary-glow)' : 'transparent', borderColor: resDecision === 'SETTLEMENT' ? 'var(--primary)' : 'var(--border-color)', fontSize: '0.75rem' }}>
                            <input type="radio" name="set" checked={resDecision === 'SETTLEMENT'} onChange={() => setResDecision('SETTLEMENT')} style={{ marginRight: '0.25rem' }} /> Import as Settlement
                          </label>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'REJECT' ? 'var(--danger-bg)' : 'transparent', borderColor: resDecision === 'REJECT' ? 'var(--danger)' : 'var(--border-color)', fontSize: '0.75rem' }}>
                            <input type="radio" name="set" checked={resDecision === 'REJECT'} onChange={() => setResDecision('REJECT')} style={{ marginRight: '0.25rem' }} /> Reject Row
                          </label>
                        </div>
                        
                        {resDecision === 'SETTLEMENT' && (
                          <div>
                            <label className="form-label">Who Received This Payment?</label>
                            <select className="form-input" value={resRecipientId} onChange={(e) => setResRecipientId(e.target.value)} required>
                              <option value="">Select recipient...</option>
                              {group.members.map((m: any) => (
                                <option key={m.userId} value={m.userId}>{m.user.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 6. AMOUNT_NEGATIVE */}
                    {selectedRow.anomalies.some(a => a.code === 'AMOUNT_NEGATIVE') && (
                      <div className="form-group">
                        <label className="form-label">Negative Amount Resolution</label>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'REFUND' ? 'var(--success-bg)' : 'transparent', borderColor: resDecision === 'REFUND' ? 'var(--success)' : 'var(--border-color)' }}>
                            <input type="radio" name="neg" checked={resDecision === 'REFUND'} onChange={() => setResDecision('REFUND')} style={{ marginRight: '0.25rem' }} /> Import as Refund
                          </label>
                          <label className="btn btn-secondary" style={{ flex: 1, backgroundColor: resDecision === 'REJECT' ? 'var(--danger-bg)' : 'transparent', borderColor: resDecision === 'REJECT' ? 'var(--danger)' : 'var(--border-color)' }}>
                            <input type="radio" name="neg" checked={resDecision === 'REJECT'} onChange={() => setResDecision('REJECT')} style={{ marginRight: '0.25rem' }} /> Reject
                          </label>
                        </div>
                      </div>
                    )}

                    {/* 7. PERCENTAGE_INVALID_SUM */}
                    {selectedRow.anomalies.some(a => a.code === 'PERCENTAGE_INVALID_SUM') && (
                      <div className="form-group">
                        <label className="form-label">Adjust Split Percentages (Sum must be 100%)</label>
                        <div className="split-matrix" style={{ marginTop: '0.25rem' }}>
                          {group.members.map((m: any) => {
                            const val = resSplits[m.userId] || '0%';
                            return (
                              <div key={m.userId} className="split-row" style={{ padding: '0.25rem 0' }}>
                                <span>{m.user.name}</span>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ width: '60px', padding: '0.25rem', textAlign: 'right', fontSize: '0.8rem' }}
                                  value={val}
                                  onChange={(e) => handleInputChange(m.userId, e.target.value)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 8. MEMBERSHIP_VIOLATION / MEMBER_NOT_IN_GROUP */}
                    {selectedRow.anomalies.some(a => a.code === 'MEMBERSHIP_VIOLATION' || a.code === 'MEMBER_NOT_IN_GROUP') && (
                      <div className="form-group">
                        <label className="form-label">Select Active Participants on Date</label>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                          Toggle checkboxes to remove inactive members (e.g. Meera in April).
                        </p>
                        <div className="split-matrix" style={{ marginTop: '0.25rem' }}>
                          {group.members.map((m: any) => {
                            const isSelected = resSplits[m.userId] !== undefined;
                            return (
                              <div key={m.userId} className="split-row" style={{ padding: '0.25rem 0' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setResSplits(prev => {
                                        const next = { ...prev };
                                        if (checked) {
                                          next[m.userId] = selectedRow.rawData.split_type === 'percentage' ? '0%' : '1';
                                        } else {
                                          delete next[m.userId];
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  {m.user.name}
                                </label>
                                {isSelected && selectedRow.rawData.split_type !== 'equal' && (
                                  <input
                                    type="text"
                                    className="form-input"
                                    style={{ width: '60px', padding: '0.25rem', textAlign: 'right', fontSize: '0.8rem' }}
                                    value={resSplits[m.userId] || ''}
                                    onChange={(e) => handleInputChange(m.userId, e.target.value)}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
                      <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                        Save Resolution
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* No row selected: Show commit summary panel */
                <div className="card" style={{ border: '1px solid var(--border-color)', textAlign: 'center', padding: '2rem 1.5rem' }}>
                  <CheckCircle2 size={36} style={{ color: session.heldRows > 0 ? 'var(--text-muted)' : 'var(--success)', marginBottom: '1rem', marginInline: 'auto' }} />
                  <h3>All Set to Commit</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
                    {session.heldRows > 0 
                      ? `There are still ${session.heldRows} held rows that require anomaly resolution before you can commit the import.` 
                      : 'All anomalies have been successfully resolved. You can now commit the CSV data atomically into your group history.'
                    }
                  </p>
                  <button
                    onClick={handleCommitImport}
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    disabled={session.heldRows > 0}
                  >
                    Commit Import Atomically
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
