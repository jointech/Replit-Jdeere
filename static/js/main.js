// Global variables
let selectedOrganizationId = null;
let selectedMachineId = null;
let machineMarkers = {};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the map
    initMap();
    
    // Set up the organization selection dropdown
    setupOrganizationSelection();
});

// Organization selection functionality
function setupOrganizationSelection() {
    const organizationItems = document.querySelectorAll('.organization-item');
    
    organizationItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            
            const orgId = this.getAttribute('data-org-id');
            const orgName = this.textContent;
            
            // Update dropdown button with organization name but keep the icon
            const dropdownButton = document.getElementById('organizationDropdown');
            dropdownButton.innerHTML = `<i class="fas fa-building me-2"></i> ${orgName}`;
            
            // Save selected organization
            selectedOrganizationId = orgId;
            
            // Load machines for this organization
            loadMachines(orgId);
        });
    });
}

// Load machines for the selected organization
function loadMachines(organizationId) {
    const machineListContainer = document.getElementById('machineListContainer');
    const machineLoader = document.getElementById('machineLoader');
    const emptyMachineMessage = document.getElementById('emptyMachineMessage');
    
    // Clear previous machine selection
    selectedMachineId = null;
    
    // Show loading
    machineListContainer.innerHTML = '';
    machineLoader.classList.remove('d-none');
    emptyMachineMessage.classList.add('d-none');
    
    // Clear map markers
    clearMapMarkers();
    
    // Reset machine details
    resetMachineDetails();
    
    // Fetch machines from API
    fetch(`/api/machines/${organizationId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar máquinas');
            }
            return response.json();
        })
        .then(machines => {
            machineLoader.classList.add('d-none');
            
            if (machines.length === 0) {
                emptyMachineMessage.textContent = 'No hay máquinas disponibles para esta organización';
                emptyMachineMessage.classList.remove('d-none');
                document.getElementById('machineCount').textContent = '0';
                return;
            }
            
            // Update machine count
            document.getElementById('machineCount').textContent = machines.length;
            
            // Render machines in the list
            renderMachineList(machines);
            
            // Add machines to map
            addMachinesToMap(machines);
        })
        .catch(error => {
            console.error('Error:', error);
            machineLoader.classList.add('d-none');
            emptyMachineMessage.textContent = 'Error al cargar máquinas: ' + error.message;
            emptyMachineMessage.classList.remove('d-none');
        });
}

// Render the machine list
function renderMachineList(machines) {
    const machineListContainer = document.getElementById('machineListContainer');
    machineListContainer.innerHTML = '';
    
    machines.forEach(machine => {
        const machineItem = document.createElement('a');
        machineItem.href = '#';
        machineItem.className = 'list-group-item list-group-item-action machine-item';
        machineItem.setAttribute('data-machine-id', machine.id);
        
        const hasLocation = machine.location && machine.location.latitude && machine.location.longitude;
        
        // Create the HTML content for the item
        machineItem.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1">${machine.name || 'Sin nombre'}</h6>
                <small>${machine.category || 'Sin categoría'}</small>
            </div>
            <small class="d-block">Modelo: ${machine.model || 'Desconocido'}</small>
            <small class="d-block ${hasLocation ? 'text-success' : 'text-muted'}">
                <i class="fas fa-${hasLocation ? 'map-marker-alt' : 'map-marker-slash'}"></i>
                ${hasLocation ? 'Ubicación disponible' : 'Sin ubicación'}
            </small>
        `;
        
        // Add click event to select this machine
        machineItem.addEventListener('click', function(e) {
            e.preventDefault();
            selectMachine(machine.id);
        });
        
        machineListContainer.appendChild(machineItem);
    });
}

// Select a machine to show details and alerts
function selectMachine(machineId) {
    // Remove active class from all machine items
    document.querySelectorAll('.machine-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active class to selected machine
    const selectedItem = document.querySelector(`.machine-item[data-machine-id="${machineId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
    }
    
    // Save selected machine
    selectedMachineId = machineId;
    
    // Focus map on selected machine
    focusMapOnMachine(machineId);
    
    // Load machine details
    loadMachineDetails(machineId);
    
    // Load machine alerts
    loadMachineAlerts(machineId);
}

// Load details for the selected machine
function loadMachineDetails(machineId) {
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');
    
    // Show loading
    machineDetailEmpty.textContent = 'Cargando detalles...';
    machineDetailEmpty.classList.remove('d-none');
    machineDetailContent.classList.add('d-none');
    
    // Fetch machine details from API
    fetch(`/api/machine/${machineId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar detalles de la máquina');
            }
            return response.json();
        })
        .then(machine => {
            // Update machine details
            document.getElementById('machineName').textContent = machine.name || 'Sin nombre';
            document.getElementById('machineModel').textContent = machine.model || 'Modelo desconocido';
            document.getElementById('machineCategory').textContent = machine.category || 'Sin categoría';
            
            // Update location info
            if (machine.location) {
                document.getElementById('machineLatitude').textContent = machine.location.latitude || '-';
                document.getElementById('machineLongitude').textContent = machine.location.longitude || '-';
                
                const timestamp = machine.location.timestamp || machine.lastUpdated;
                document.getElementById('machineLocationUpdate').textContent = timestamp ? 
                    new Date(timestamp).toLocaleString() : 'Desconocido';
            } else {
                document.getElementById('machineLatitude').textContent = '-';
                document.getElementById('machineLongitude').textContent = '-';
                document.getElementById('machineLocationUpdate').textContent = 'No disponible';
            }
            
            // Show content
            machineDetailEmpty.classList.add('d-none');
            machineDetailContent.classList.remove('d-none');
        })
        .catch(error => {
            console.error('Error:', error);
            machineDetailEmpty.textContent = 'Error al cargar detalles: ' + error.message;
        });
}

// Load alerts for the selected machine
function loadMachineAlerts(machineId) {
    const alertListContainer = document.getElementById('alertListContainer');
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    
    // Show loading
    alertListContainer.innerHTML = '';
    emptyAlertMessage.textContent = 'Cargando alertas...';
    emptyAlertMessage.classList.remove('d-none');
    
    // Fetch machine alerts from API
    fetch(`/api/machine/${machineId}/alerts`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar alertas');
            }
            return response.json();
        })
        .then(alerts => {
            if (alerts.length === 0) {
                emptyAlertMessage.textContent = 'No hay alertas para esta máquina';
                return;
            }
            
            // Hide empty message
            emptyAlertMessage.classList.add('d-none');
            
            // Render alerts in the list
            renderAlertList(alerts);
        })
        .catch(error => {
            console.error('Error:', error);
            emptyAlertMessage.textContent = 'Error al cargar alertas: ' + error.message;
        });
}

// Render the alert list
function renderAlertList(alerts) {
    const alertListContainer = document.getElementById('alertListContainer');
    alertListContainer.innerHTML = '';
    
    alerts.forEach(alert => {
        const alertItem = document.createElement('div');
        alertItem.className = 'list-group-item';
        
        // Determine severity class
        let severityClass, severityIcon;
        switch (alert.severity && alert.severity.toLowerCase()) {
            case 'critical':
                severityClass = 'text-danger';
                severityIcon = 'exclamation-circle';
                break;
            case 'warning':
                severityClass = 'text-warning';
                severityIcon = 'exclamation-triangle';
                break;
            default:
                severityClass = 'text-info';
                severityIcon = 'info-circle';
        }
        
        // Format timestamp
        const timestamp = alert.timestamp ? new Date(alert.timestamp).toLocaleString() : 'Desconocido';
        
        // Create the HTML content for the alert
        alertItem.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1 ${severityClass}">
                    <i class="fas fa-${severityIcon} me-2"></i>
                    ${alert.title || 'Alerta sin título'}
                </h6>
                <small>${alert.status || 'Estado desconocido'}</small>
            </div>
            <p class="mb-1 small">${alert.description || 'Sin descripción'}</p>
            <small class="text-muted">${timestamp}</small>
        `;
        
        alertListContainer.appendChild(alertItem);
    });
}

// Reset machine details
function resetMachineDetails() {
    // Reset alerts
    document.getElementById('emptyAlertMessage').textContent = 'Seleccione una máquina para ver sus alertas';
    document.getElementById('emptyAlertMessage').classList.remove('d-none');
    document.getElementById('alertListContainer').innerHTML = '';
    
    // Reset machine details
    document.getElementById('machineDetailEmpty').classList.remove('d-none');
    document.getElementById('machineDetailContent').classList.add('d-none');
}
