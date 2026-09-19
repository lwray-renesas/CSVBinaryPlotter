
// static function useful for setting button colour depending on axis.
function updateAxisButtonColour(button, dataset) {
  if (dataset.yAxisID === 'y1') {
    button.style.color = '#f59e0b';
    button.style.background = 'rgba(245,158,11,0.15)';

  } else {
    button.style.color = '#60a5fa';
    button.style.background = 'rgba(59,130,246,0.15)';
  }
}

// class to manage a signal list view (interactive legend for chart)
export class SignalListView {
  constructor(root, signalManager, chartManager) {
    this.root = root;
    this.signalManager = signalManager;
    this.chartManager = chartManager;
  }

  // constructs the signal list view (interactive legend) based on latest
  // information from signal/chart managers.
  rebuild() {
    this.root.innerHTML = '';
    this.signalManager.visualItems().forEach(item => {
      const ds = this.signalManager.getDataset(item.index);

      // Grab the template from index.html
      const template = document.getElementById('signalRowTemplate');
      // create a row from it
      const row = template.content.firstElementChild.cloneNode(true);
      const colour = row.querySelector('.signal-colour');
      const name = row.querySelector('.signal-name');
      const axis = row.querySelector('.axis-toggle');
      row.dataset.index = item.index;

      // Create colour element
      colour.style.background = ds.borderColor;
      const visible = this.chartManager.isDatasetVisible(item.index);
      colour.style.opacity = visible ? '1' : '0.25';

      // Initial content
      name.innerText = ds.label;

      axis.innerText = ds.yAxisID === 'y1' ? 'R' : 'L';
      updateAxisButtonColour(axis, ds);

      // Axis toggle
      axis.onclick = () => {
        ds.yAxisID = ds.yAxisID === 'y' ? 'y1' : 'y';
        this.rebuild();
        this.chartManager.synchronise();
      };

      // Visibility toggle
      colour.onclick = () => {
        const visible = this.chartManager.isDatasetVisible(item.index);
        this.chartManager.setDatasetVisibility(item.index, !visible);
        colour.style.opacity = visible ? '0.25' : '1';
      };

      this.root.appendChild(row);
    });
  }
}
