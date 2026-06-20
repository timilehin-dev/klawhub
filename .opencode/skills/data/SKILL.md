# Data (v1.2.1)

Expert data analysis, visualization, and dashboard building. SQL, Python/pandas, statistical modeling, and data validation.

## Commands

### /data:analyze
Deep exploratory data analysis. Infers your goals from context or prompts for them. Generates a plan covering data loading, cleaning, transformations, and analysis. Produces a report with key findings, visualizations, and recommendations.

**Flow**: Understand → Plan → Execute → Document

### /data:build-dashboard
Design and build an interactive dashboard from scratch. Discovers data sources, suggests layout and visualizations, then builds iteratively (placeholder → MVP → polish).

**Steps**: 1) Understand data & audience, 2) Wireframe layout, 3) Build MVP with one chart, 4) Add remaining components, 5) Polish styling

### /data:sql
Expert SQL query writing and optimization. Supports all major dialects (PostgreSQL, MySQL, Snowflake, BigQuery, Redshift, SQLite, MS SQL Server, Oracle, Presto/Trino, Databricks, DuckDB). Handles `CREATE TABLE`, `SELECT`, CTEs, window functions, aggregations, JOINs, indexes, query tuning, and query explain analysis.

### /data:viz
Create publication-quality charts (matplotlib, seaborn, ggplot2, plotly, D3). Follows Wilkinson's grammar of graphics. Outputs .png, .svg, .html, or .py/.r scripts. Supports bar, line, scatter, heatmap, boxplot, histogram, area, bubble, choropleth, network, Sankey, sunburst, treemap, 3D surface, and animated charts.

### /data:stats
Statistical analysis: descriptive stats, normality tests (Shapiro-Wilk, KS, Anderson-Darling), hypothesis testing (t-test, Mann-Whitney, chi-squared, ANOVA, Kruskal-Wallis), effect size (Cohen's d, eta-squared, Cramer's V), correlation (Pearson, Spearman, point-biserial, phi, tetrachoric), regression (linear, logistic, multiple, polynomial, stepwise, ridge, lasso, Poisson), power analysis, Bayesian methods, time series (ARIMA, exponential smoothing, STL, Granger causality, changepoint detection), cluster analysis (k-means, hierarchical, DBSCAN, GMM), PCA/FA, survival analysis (Kaplan-Meier, Cox PH), and non-parametric tests.

### /data:validation
Data quality validation framework. Scans for missing values, duplicates, outliers, type mismatches, domain/range violations, uniqueness violations, cross-field consistency, temporal anomalies, distribution drift, and referential integrity. Produces a validation report with severity ratings and remediation steps.

## Workflows

- **Ad-hoc analysis**: `/data:analyze` with raw data or file path
- **Dashboard**: `/data:build-dashboard` to create multi-view interactive dashboards
- **SQL optimization**: `/data:sql` to write, tune, or explain queries
- **Statistical tests**: `/data:stats` for hypothesis testing and modeling
- **Chart creation**: `/data:viz` from dataframe or analysis results
- **Data validation**: `/data:validation` to profile and quality-check datasets
