import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [availableFunds, setAvailableFunds] = useState([]);
  const [fund, setFund] = useState('All Funds');
  const [overallChange, setOverallChange] = useState(0);
  const [protectRevenue, setProtectRevenue] = useState(true);
  const [quartileChanges, setQuartileChanges] = useState({
    '1st Quartile': 5,
    '2nd Quartile': 2,
    '3rd Quartile': -2,
    '4th Quartile': -5
  });
  const [results, setResults] = useState(null);
  const [fundProgress, setFundProgress] = useState(() => {
    const saved = localStorage.getItem('pbb-fund-progress');
    return saved ? JSON.parse(saved) : {};
  });
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');

  React.useEffect(() => {
    localStorage.setItem('pbb-fund-progress', JSON.stringify(fundProgress));
  }, [fundProgress]);

  const normalizeQuartile = (quartile) => {
    if (!quartile) return null;
    const q = quartile.toString().toLowerCase().trim();
    if (q === '1' || q.includes('most aligned')) return '1st Quartile';
    if (q === '2' || q.includes('more aligned')) return '2nd Quartile';
    if (q === '3' || q.includes('less aligned')) return '3rd Quartile';
    if (q === '4' || q.includes('least aligned')) return '4th Quartile';
    if (q.includes('1st')) return '1st Quartile';
    if (q.includes('2nd')) return '2nd Quartile';
    if (q.includes('3rd')) return '3rd Quartile';
    if (q.includes('4th')) return '4th Quartile';
    return quartile;
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    
    try {
      const data = await uploadedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets['Details'];
      if (!worksheet) {
        alert('Error: Could not find "Details" sheet in the file.');
        return;
      }
      
      const detailsData = XLSX.utils.sheet_to_json(worksheet);
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      const funds = [...new Set(detailsData.map(row => row.Fund))].filter(f => f).sort();
      setAvailableFunds(['All Funds', ...funds]);
      
      // Group by program_id + department + fund combination
      const programMap = {};
      detailsData.forEach((row, index) => {
        const programId = row.program_id;
        if (!programId) return;
        
        const rawRow = rawData[index + 1];
        const departmentFromColumnD = rawRow ? rawRow[3] : 'N/A';
        const programFromColumnV = rawRow ? rawRow[21] : 'Unknown Program';
        const fundName = row.Fund;
        
        // Create unique key for program + department + fund combination
        const key = `${programId}_${departmentFromColumnD}_${fundName}`;
        
        if (!programMap[key]) {
          programMap[key] = {
            program_id: programId,
            Program: programFromColumnV || 'Unknown Program',
            Department: departmentFromColumnD || 'N/A',
            Quartile: normalizeQuartile(row.Quartile),
            'Final Score': row['Final Score'],
            Personnel: 0,
            NonPersonnel: 0,
            Revenue: 0,
            Budget: 0,
            funds: new Set(),
            fundBreakdown: {}
          };
        }
        
        const amount = parseFloat(row['Total Item Cost']) || 0;
        const acctType = row.AcctType;
        const costType = row['Cost Type'];
        
        programMap[key].funds.add(fundName);
        if (!programMap[key].fundBreakdown[fundName]) {
          programMap[key].fundBreakdown[fundName] = 0;
        }
        if (acctType === 'Expense') {
          programMap[key].Budget += amount;
          programMap[key].fundBreakdown[fundName] += amount;
          if (costType === 'Personnel') {
            programMap[key].Personnel += amount;
          } else if (costType === 'NonPersonnel') {
            programMap[key].NonPersonnel += amount;
          }
        } else if (acctType === 'Revenue') {
          programMap[key].Revenue += amount;
        }
      });
      
      const programsArray = Object.values(programMap).map(p => ({
        ...p,
        funds: Array.from(p.funds),
        primaryFund: Array.from(p.funds)[0]
      }));
      setPrograms(programsArray);
      alert(`Successfully loaded ${programsArray.length} programs from ${detailsData.length} detail records!`);
    } catch (error) {
      console.error('Error details:', error);
      alert('Error reading file. Please ensure it contains a "Details" sheet.');
    }
  };
  
  const calculateTargetBudgets = () => {
    if (programs.length === 0) {
      alert('Please upload a file first');
      return;
    }
    let filteredPrograms = programs;
    if (fund !== 'All Funds') {
      filteredPrograms = programs.filter(p => p.funds.includes(fund));
    }
    const validPrograms = filteredPrograms.filter(p => {
      const budget = parseFloat(p.Budget);
      return !isNaN(budget) && budget !== 0;
    });
    const calculated = validPrograms.map(program => {
      const budget = parseFloat(program.Budget);
      const revenue = parseFloat(program.Revenue) || 0;
      const quartile = program.Quartile;
      let quartileChange = quartileChanges[quartile] || 0;
      let targetBudget = budget * (1 + quartileChange / 100);
      if (protectRevenue && revenue > 0 && quartileChange < 0) {
        targetBudget = Math.max(targetBudget, revenue);
      }
      const changeAmount = targetBudget - budget;
      const changePercent = budget !== 0 ? (changeAmount / budget) * 100 : 0;
      return { ...program, targetBudget, changeAmount, changePercent };
    });
    const totalOriginal = calculated.reduce((sum, p) => sum + parseFloat(p.Budget), 0);
    const totalTarget = calculated.reduce((sum, p) => sum + p.targetBudget, 0);
    const totalChange = totalTarget - totalOriginal;
    const totalChangePercent = totalOriginal !== 0 ? (totalChange / totalOriginal) * 100 : 0;
    const byQuartile = {};
    ['1st Quartile', '2nd Quartile', '3rd Quartile', '4th Quartile'].forEach(q => {
      const quartilePrograms = calculated.filter(p => p.Quartile === q);
      const origBudget = quartilePrograms.reduce((sum, p) => sum + parseFloat(p.Budget), 0);
      const targBudget = quartilePrograms.reduce((sum, p) => sum + p.targetBudget, 0);
      byQuartile[q] = {
        count: quartilePrograms.length,
        originalBudget: origBudget,
        targetBudget: targBudget,
        change: targBudget - origBudget,
        changePercent: origBudget !== 0 ? (targBudget - origBudget) / origBudget * 100 : 0
      };
    });
    const departmentMap = {};
    calculated.forEach(program => {
      const dept = program.Department;
      console.log('Program:', program.Program, 'Department:', program.Department);
      if (!departmentMap[dept]) {
        departmentMap[dept] = {
          department: dept,
          accountingFundAllocation: 0,
          otherFundAllocations: 0,
          programRevenue: 0,
          programCount: 0
        };
      }
      departmentMap[dept].accountingFundAllocation += program.targetBudget;
      departmentMap[dept].programRevenue += parseFloat(program.Revenue) || 0;
      departmentMap[dept].programCount += 1;
      if (fund !== 'All Funds' && program.fundBreakdown) {
        Object.entries(program.fundBreakdown).forEach(([fundName, amount]) => {
          if (fundName !== fund) {
            departmentMap[dept].otherFundAllocations += amount;
          }
        });
      }
    });
    const byDepartment = Object.values(departmentMap).sort((a, b) => b.accountingFundAllocation - a.accountingFundAllocation);
    setResults({
      programs: calculated,
      summary: { totalOriginal, totalTarget, totalChange, totalChangePercent, fundFilter: fund },
      byQuartile,
      byDepartment
    });
    if (fund !== 'All Funds') {
      setFundProgress(prev => ({
        ...prev,
        [fund]: {
          calculated: true,
          saved: prev[fund]?.saved || false,
          lastCalculated: new Date().toISOString(),
          totalOriginal, totalTarget, totalChange, totalChangePercent,
          quartileSettings: { ...quartileChanges }
        }
      }));
    }
  };

  const saveFundProgress = () => {
    if (!results || fund === 'All Funds') {
      alert('Please select a specific fund and calculate results before saving.');
      return;
    }
    setFundProgress(prev => ({
      ...prev,
      [fund]: { ...prev[fund], saved: true, savedAt: new Date().toISOString() }
    }));
    alert(`Progress saved for ${fund}!`);
  };

  const clearAllProgress = () => {
    if (window.confirm('Are you sure you want to clear all saved progress? This cannot be undone.')) {
      setFundProgress({});
      localStorage.removeItem('pbb-fund-progress');
      alert('All progress has been cleared.');
    }
  };

  const exportToExcel = () => {
    if (!results) return;
    const wb = XLSX.utils.book_new();
    const deptData = results.byDepartment.map(d => {
      const row = { Department: d.department, 'Program Count': d.programCount };
      if (fund !== 'All Funds') {
        row[`${fund} Allocation`] = d.accountingFundAllocation.toFixed(2);
        row['Other Fund Allocations'] = d.otherFundAllocations.toFixed(2);
      } else {
        row['Accounting Fund Allocation'] = d.accountingFundAllocation.toFixed(2);
      }
      row['Program Revenue'] = d.programRevenue.toFixed(2);
      row['Total Resources'] = (d.accountingFundAllocation + d.otherFundAllocations + d.programRevenue).toFixed(2);
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deptData), 'Department Targets');
    const progWs = XLSX.utils.json_to_sheet(results.programs.map(p => ({
      Program: p.Program,
      Department: p.Department,
      Quartile: p.Quartile,
      'Primary Fund': p.primaryFund,
      'Original Budget': parseFloat(p.Budget) || 0,
      'Target Budget': p.targetBudget.toFixed(2),
      'Change Amount': p.changeAmount.toFixed(2),
      'Change %': p.changePercent.toFixed(2)
    })));
    XLSX.utils.book_append_sheet(wb, progWs, 'Program Details');
    const allFunds = [...new Set(results.programs.flatMap(p => p.funds))].sort();
    const fundingMatrix = {};
    results.programs.forEach(program => {
      const dept = program.Department;
      if (!fundingMatrix[dept]) {
        fundingMatrix[dept] = { Department: dept, 'Program Revenue': 0 };
        allFunds.forEach(f => { fundingMatrix[dept][f] = 0; });
      }
      fundingMatrix[dept]['Program Revenue'] += parseFloat(program.Revenue) || 0;
      if (program.fundBreakdown) {
        Object.entries(program.fundBreakdown).forEach(([fundName, amount]) => {
          fundingMatrix[dept][fundName] = (fundingMatrix[dept][fundName] || 0) + amount;
        });
      }
    });
    const matrixData = Object.values(fundingMatrix).map(row => {
      const total = allFunds.reduce((sum, f) => sum + (row[f] || 0), 0) + row['Program Revenue'];
      return { ...row, 'Total Resources': total.toFixed(2) };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrixData), 'Department Funding Matrix');
    XLSX.writeFile(wb, `PBB_Target_Budgets_${fund.replace(/\s+/g, '_')}.xlsx`);
  };

  const formatCurrency = (num) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>PBB Target Budget Calculator</h1>
          <p>Upload your Summary Report and configure target budgets using Priority Based Budgeting</p>
        </header>
        <div className="upload-section">
          <label htmlFor="file-upload" className="upload-button">
            Choose Summary Report File
            <input id="file-upload" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
          {file && <p className="file-name">{file.name} ({programs.length} programs loaded)</p>}
          {availableFunds.length > 1 && (
            <button className="dashboard-toggle" onClick={() => setShowDashboard(!showDashboard)}>
              {showDashboard ? 'Hide' : 'Show'} Fund Progress Dashboard
            </button>
          )}
        </div>
        {showDashboard && availableFunds.length > 1 && (
          <div className="fund-dashboard">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: 0 }}>Fund Progress Dashboard</h2>
                <p className="dashboard-subtitle" style={{ margin: '5px 0 0 0' }}>Track your progress across all accounting funds</p>
              </div>
              {Object.keys(fundProgress).length > 0 && (
                <button onClick={clearAllProgress} style={{ padding: '10px 20px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer' }}>
                  Clear All Progress
                </button>
              )}
            </div>
            <div className="fund-summary-cards">
              <div className="summary-stat"><h4>Total Funds</h4><p className="stat-number">{availableFunds.length - 1}</p></div>
              <div className="summary-stat"><h4>Calculated</h4><p className="stat-number">{Object.values(fundProgress).filter(f => f.calculated).length}</p></div>
              <div className="summary-stat"><h4>Saved</h4><p className="stat-number">{Object.values(fundProgress).filter(f => f.saved).length}</p></div>
            </div>
            <div className="fund-list">
              <table>
                <thead>
                  <tr><th>Fund</th><th>Status</th><th>Original Budget</th><th>Target Budget</th><th>Change</th><th>Change %</th><th>Last Updated</th></tr>
                </thead>
                <tbody>
                  {availableFunds.filter(f => f !== 'All Funds').map(fundName => {
                    const progress = fundProgress[fundName];
                    return (
                      <tr key={fundName} className={fund === fundName ? 'active-fund' : ''}>
                        <td><strong>{fundName}</strong>{fund === fundName && <span className="current-badge">Current</span>}</td>
                        <td>{progress?.saved ? <span className="status-badge saved">Saved</span> : progress?.calculated ? <span className="status-badge calculated">Calculated</span> : <span className="status-badge pending">Pending</span>}</td>
                        <td>{progress ? formatCurrency(progress.totalOriginal) : '-'}</td>
                        <td>{progress ? formatCurrency(progress.totalTarget) : '-'}</td>
                        <td className={progress ? (progress.totalChange >= 0 ? 'positive' : 'negative') : ''}>{progress ? formatCurrency(progress.totalChange) : '-'}</td>
                        <td className={progress ? (progress.totalChangePercent >= 0 ? 'positive' : 'negative') : ''}>{progress ? `${progress.totalChangePercent.toFixed(2)}%` : '-'}</td>
                        <td>{progress?.lastCalculated ? new Date(progress.lastCalculated).toLocaleString() : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="config-section">
          <h2>Configuration</h2>
          <div className="config-grid">
            <div className="config-item">
              <label>Accounting Fund</label>
              <select value={fund} onChange={(e) => setFund(e.target.value)}>{availableFunds.map(f => <option key={f} value={f}>{f}</option>)}</select>
            </div>
            <div className="config-item">
              <label>Overall Budget Change (%)</label>
              <input type="number" value={overallChange} onChange={(e) => { const val = e.target.value; setOverallChange(val === '' || val === '-' ? 0 : parseFloat(val)); }} step="0.1" />
            </div>
            <div className="config-item checkbox-item">
              <label><input type="checkbox" checked={protectRevenue} onChange={(e) => setProtectRevenue(e.target.checked)} />Protect Revenue-Generating Programs</label>
            </div>
          </div>
          <h3>Quartile Budget Changes (%)</h3>
          <div className="quartile-grid">
            {Object.keys(quartileChanges).map(quartile => (
              <div key={quartile} className="quartile-item">
                <label>{quartile}</label>
                <input type="number" value={quartileChanges[quartile]} onChange={(e) => { const val = e.target.value; setQuartileChanges({ ...quartileChanges, [quartile]: val === '' || val === '-' ? 0 : parseFloat(val) }); }} step="0.1" />
              </div>
            ))}
          </div>
          <button className="calculate-button" onClick={calculateTargetBudgets}>Calculate Target Budgets</button>
        </div>
        {results && (
          <div className="results-section">
            <div className="results-header">
              <h2>Results {results.summary.fundFilter !== 'All Funds' && `(${results.summary.fundFilter})`}</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                {fund !== 'All Funds' && (
                  <button className="save-button" onClick={saveFundProgress} style={{ padding: '12px 30px', background: fundProgress[fund]?.saved ? '#28a745' : '#ffc107', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' }}>
                    {fundProgress[fund]?.saved ? 'Saved' : 'Save Progress'}
                  </button>
                )}
                <button className="export-button" onClick={exportToExcel}>Export to Excel</button>
              </div>
            </div>
            <div className="tab-navigation">
              <button className={`tab-button ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>Summary & Tables</button>
              <button className={`tab-button ${activeTab === 'visualizations' ? 'active' : ''}`} onClick={() => setActiveTab('visualizations')}>Visualizations</button>
            </div>
            {activeTab === 'summary' && (
              <div className="tab-content">
                <div className="summary-cards">
                  <div className="summary-card"><h3>Original Budget</h3><p className="big-number">{formatCurrency(results.summary.totalOriginal)}</p></div>
                  <div className="summary-card"><h3>Target Budget</h3><p className="big-number">{formatCurrency(results.summary.totalTarget)}</p></div>
                  <div className="summary-card"><h3>Total Change</h3><p className={`big-number ${results.summary.totalChange >= 0 ? 'positive' : 'negative'}`}>{formatCurrency(results.summary.totalChange)}</p><p className="percentage">({results.summary.totalChangePercent.toFixed(2)}%)</p></div>
                </div>
                <h3>By Quartile</h3>
                <div className="quartile-results">
                  {Object.entries(results.byQuartile).map(([quartile, data]) => (
                    <div key={quartile} className="quartile-card">
                      <h4>{quartile}</h4><p>Programs: {data.count}</p><p>Original: {formatCurrency(data.originalBudget)}</p><p>Target: {formatCurrency(data.targetBudget)}</p>
                      <p className={data.change >= 0 ? 'positive' : 'negative'}>Change: {formatCurrency(data.change)} ({data.changePercent.toFixed(2)}%)</p>
                    </div>
                  ))}
                </div>
                <h3>Department Targets</h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr><th>Department</th><th>Programs</th><th>{fund !== 'All Funds' ? `${fund} Allocation` : 'Accounting Fund Allocation'}</th>{fund !== 'All Funds' && <th>Other Fund Allocations</th>}<th>Program Revenue</th><th>Total Resources</th></tr>
                    </thead>
                    <tbody>
                      {results.byDepartment.map((dept, idx) => (
                        <tr key={idx}>
                          <td>{dept.department}</td><td>{dept.programCount}</td><td>{formatCurrency(dept.accountingFundAllocation)}</td>
                          {fund !== 'All Funds' && <td>{formatCurrency(dept.otherFundAllocations)}</td>}<td>{formatCurrency(dept.programRevenue)}</td>
                          <td className="positive">{formatCurrency(dept.accountingFundAllocation + dept.otherFundAllocations + dept.programRevenue)}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 'bold', borderTop: '2px solid #667eea' }}>
                        <td>TOTAL</td><td>{results.byDepartment.reduce((sum, d) => sum + d.programCount, 0)}</td>
                        <td>{formatCurrency(results.byDepartment.reduce((sum, d) => sum + d.accountingFundAllocation, 0))}</td>
                        {fund !== 'All Funds' && <td>{formatCurrency(results.byDepartment.reduce((sum, d) => sum + d.otherFundAllocations, 0))}</td>}
                        <td>{formatCurrency(results.byDepartment.reduce((sum, d) => sum + d.programRevenue, 0))}</td>
                        <td className="positive">{formatCurrency(results.byDepartment.reduce((sum, d) => sum + d.accountingFundAllocation + d.otherFundAllocations + d.programRevenue, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <h3>Program Details</h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr><th>Program</th><th>Department</th><th>Quartile</th><th>Original Budget</th><th>Target Budget</th><th>Change</th><th>Change %</th></tr>
                    </thead>
                    <tbody>
                      {results.programs.map((program, idx) => (
                        <tr key={idx}>
                          <td>{program.Program}</td><td>{program.Department}</td><td>{program.Quartile}</td>
                          <td>{formatCurrency(parseFloat(program.Budget) || 0)}</td><td>{formatCurrency(program.targetBudget)}</td>
                          <td className={program.changeAmount >= 0 ? 'positive' : 'negative'}>{formatCurrency(program.changeAmount)}</td>
                          <td className={program.changePercent >= 0 ? 'positive' : 'negative'}>{program.changePercent.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {activeTab === 'visualizations' && (
              <div className="tab-content">
                <h3>Quartile Funding Breakdown</h3>
                <p style={{ color: '#666', marginBottom: '20px' }}>Horizontal bar chart showing funding sources by quartile</p>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={Object.entries(results.byQuartile).reverse().map(([quartile]) => {
                    const quartilePrograms = results.programs.filter(p => p.Quartile === quartile);
                    const fundTotals = {};
                    let totalProgramRevenue = 0;
                    quartilePrograms.forEach(program => {
                      if (program.fundBreakdown) {
                        Object.entries(program.fundBreakdown).forEach(([fundName, amount]) => {
                          fundTotals[fundName] = (fundTotals[fundName] || 0) + amount;
                        });
                      }
                      totalProgramRevenue += parseFloat(program.Revenue) || 0;
                    });
                    return { quartile, 'Program Revenue': totalProgramRevenue, ...fundTotals };
                  })} layout="vertical" margin={{ top: 20, right: 30, left: 100, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`} />
                    <YAxis dataKey="quartile" type="category" />
                    <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                    <Legend />
                    <Bar dataKey="Program Revenue" stackId="a" fill="#28a745" />
                    {results.programs.length > 0 && results.programs[0].fundBreakdown && Object.keys(results.programs[0].fundBreakdown).slice(0, 10).map((fundName, idx) => {
                      const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff'];
                      return <Bar key={fundName} dataKey={fundName} stackId="a" fill={colors[idx % colors.length]} />;
                    })}
                  </BarChart>
                </ResponsiveContainer>
                <h3 style={{ marginTop: '60px' }}>Department Funding Sources</h3>
                <p style={{ color: '#666', marginBottom: '20px' }}>Pie charts showing funding composition for top departments</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '40px' }}>
                  {results.byDepartment.slice(0, 6).map((dept, idx) => {
                    const deptPrograms = results.programs.filter(p => p.Department === dept.department);
                    const fundingSources = {};
                    let totalProgramRevenue = 0;
                    deptPrograms.forEach(program => {
                      if (program.fundBreakdown) {
                        Object.entries(program.fundBreakdown).forEach(([fundName, amount]) => {
                          fundingSources[fundName] = (fundingSources[fundName] || 0) + amount;
                        });
                      }
                      totalProgramRevenue += parseFloat(program.Revenue) || 0;
                    });
                    if (totalProgramRevenue > 0) fundingSources['Program Revenue'] = totalProgramRevenue;
                    const pieData = Object.entries(fundingSources).map(([name, value]) => ({ name, value }));
                    const COLORS = ['#667eea', '#764ba2', '#28a745', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#feca57'];
                    return (
                      <div key={idx} style={{ background: '#f8f9fa', padding: '20px', borderRadius: '10px' }}>
                        <h4 style={{ textAlign: 'center', marginBottom: '10px' }}>{dept.department}</h4>
                        <p style={{ textAlign: 'center', color: '#666', fontSize: '0.9rem', marginBottom: '20px' }}>
                          Total: {formatCurrency(dept.accountingFundAllocation + dept.otherFundAllocations + dept.programRevenue)}
                        </p>
                        <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={false}
                                        outerRadius={80}
                                        fill="#8884d8"
                                        dataKey="value"
                                    >
                                        {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(value) => formatCurrency(value)} />
                                    <Legend
                                        wrapperStyle={{ fontSize: '12px' }}
                                        formatter={(value, entry) => {
                                            const percent = ((entry.payload.value / pieData.reduce((sum, d) => sum + d.value, 0)) * 100).toFixed(0);
                                            return `${value} (${percent}%)`;
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>

                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;