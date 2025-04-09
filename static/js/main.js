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
    console.log("Configurando selección de organizaciones");
    
    // Añadir manejadores a los elementos existentes
    addOrganizationClickHandlers();
    
    // También agregar un controlador de eventos al elemento padre para manejar delegación de eventos
    // Esto ayudará si los elementos se recrean dinámicamente
    document.getElementById('organizationList').addEventListener('click', function(e) {
        // Verificar si el elemento clicado o alguno de sus padres es un .organization-item
        const item = e.target.closest('.organization-item');
        if (item) {
            e.preventDefault();
            const orgId = item.getAttribute('data-org-id');
            const orgName = item.textContent.trim();
            
            console.log(`Organización seleccionada: ${orgName} (${orgId})`);
            
            // Update dropdown button with organization name but keep the icon
            const dropdownButton = document.getElementById('organizationDropdown');
            if (dropdownButton) {
                dropdownButton.innerHTML = `<i class="fas fa-building me-2"></i> ${orgName}`;
            } else {
                console.error("No se encontró el elemento dropdownButton");
            }
            
            // Save selected organization
            selectedOrganizationId = orgId;
            
            // Load machines for this organization
            loadMachines(orgId);
        }
    });
}

// Función auxiliar para añadir manejadores de clic a elementos de organización
function addOrganizationClickHandlers() {
    const organizationItems = document.querySelectorAll('.organization-item');
    console.log(`Encontrados ${organizationItems.length} elementos de organización`);
    
    organizationItems.forEach(item => {
        const orgId = item.getAttribute('data-org-id');
        const orgName = item.textContent.trim();
        console.log(`  - ${orgName} (${orgId})`);
    });
}

// Load machines for the selected organization
function loadMachines(organizationId) {
    console.log(`Cargando máquinas para la organización: ${organizationId}`);
    
    // Obtener referencias a los elementos del DOM
    const machineListContainer = document.getElementById('machineListContainer');
    const machineLoader = document.getElementById('machineLoader');
    const emptyMachineMessage = document.getElementById('emptyMachineMessage');
    const machineCountElement = document.getElementById('machineCount');
    
    // Verificar que los elementos existen
    if (!machineListContainer) {
        console.error("No se encontró el elemento machineListContainer");
        return;
    }
    
    // Clear previous machine selection
    selectedMachineId = null;
    
    // Show loading
    machineListContainer.innerHTML = '';
    
    if (machineLoader) {
        machineLoader.classList.remove('d-none');
    }
    
    if (emptyMachineMessage) {
        emptyMachineMessage.classList.add('d-none');
    }
    
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
            console.log(`Recibidas ${machines.length} máquinas para la organización ${organizationId}`);
            
            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }
            
            if (machines.length === 0) {
                if (emptyMachineMessage) {
                    emptyMachineMessage.textContent = 'No hay máquinas disponibles para esta organización';
                    emptyMachineMessage.classList.remove('d-none');
                }
                
                if (machineCountElement) {
                    machineCountElement.textContent = '0';
                }
                return;
            }
            
            // Update machine count
            if (machineCountElement) {
                machineCountElement.textContent = machines.length;
            }
            
            // Render machines in the list
            renderMachineList(machines);
            
            // Add machines to map
            addMachinesToMap(machines);
        })
        .catch(error => {
            console.error('Error:', error);
            
            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }
            
            if (emptyMachineMessage) {
                emptyMachineMessage.textContent = 'Error al cargar máquinas: ' + error.message;
                emptyMachineMessage.classList.remove('d-none');
            }
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
    console.log(`Seleccionando máquina: ${machineId}`);
    
    try {
        // Remove active class from all machine items
        const machineItems = document.querySelectorAll('.machine-item');
        if (machineItems && machineItems.length > 0) {
            machineItems.forEach(item => {
                if (item && item.classList) {
                    item.classList.remove('active');
                }
            });
        }
        
        // Add active class to selected machine
        const selectedItem = document.querySelector(`.machine-item[data-machine-id="${machineId}"]`);
        if (selectedItem && selectedItem.classList) {
            selectedItem.classList.add('active');
        } else {
            console.warn(`No se encontró elemento para la máquina con ID: ${machineId}`);
        }
        
        // Save selected machine
        selectedMachineId = machineId;
        
        // Focus map on selected machine
        focusMapOnMachine(machineId);
        
        // Load machine details
        loadMachineDetails(machineId);
        
        // Load machine alerts
        loadMachineAlerts(machineId);
    } catch (error) {
        console.error(`Error al seleccionar máquina ${machineId}:`, error);
    }
}

// Load details for the selected machine
function loadMachineDetails(machineId) {
    console.log(`Cargando detalles para máquina: ${machineId}`);
    
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');
    
    if (!machineDetailEmpty || !machineDetailContent) {
        console.error("No se encontraron los contenedores de detalles de máquina");
        return;
    }
    
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
            console.log("Detalles de máquina recibidos:", machine);
            
            // Update machine details
            const machineName = document.getElementById('machineName');
            const machineModel = document.getElementById('machineModel');
            const machineCategory = document.getElementById('machineCategory');
            const machineLatitude = document.getElementById('machineLatitude');
            const machineLongitude = document.getElementById('machineLongitude');
            const machineLocationUpdate = document.getElementById('machineLocationUpdate');
            
            // Actualizar elementos solo si existen
            if (machineName) machineName.textContent = machine.name || 'Sin nombre';
            if (machineModel) machineModel.textContent = machine.model || 'Modelo desconocido';
            if (machineCategory) machineCategory.textContent = machine.category || 'Sin categoría';
            
            // Update location info
            if (machine.location) {
                if (machineLatitude) machineLatitude.textContent = machine.location.latitude || '-';
                if (machineLongitude) machineLongitude.textContent = machine.location.longitude || '-';
                
                const timestamp = machine.location.timestamp || machine.lastUpdated;
                if (machineLocationUpdate) {
                    machineLocationUpdate.textContent = timestamp ? 
                        new Date(timestamp).toLocaleString() : 'Desconocido';
                }
            } else {
                if (machineLatitude) machineLatitude.textContent = '-';
                if (machineLongitude) machineLongitude.textContent = '-';
                if (machineLocationUpdate) machineLocationUpdate.textContent = 'No disponible';
            }
            
            // Show content
            machineDetailEmpty.classList.add('d-none');
            machineDetailContent.classList.remove('d-none');
        })
        .catch(error => {
            console.error('Error:', error);
            if (machineDetailEmpty) {
                machineDetailEmpty.textContent = 'Error al cargar detalles: ' + error.message;
            }
        });
}

// Load alerts for the selected machine
function loadMachineAlerts(machineId) {
    console.log(`Cargando alertas para máquina: ${machineId}`);
    
    const alertListContainer = document.getElementById('alertListContainer');
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    
    if (!alertListContainer || !emptyAlertMessage) {
        console.error("No se encontraron los contenedores de alertas");
        return;
    }
    
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
            console.log(`Recibidas ${alerts.length} alertas para la máquina ${machineId}`);
            
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
            if (emptyAlertMessage) {
                emptyAlertMessage.textContent = 'Error al cargar alertas: ' + error.message;
            }
        });
}

// Render the alert list
function renderAlertList(alerts) {
    console.log(`Renderizando lista de ${alerts.length} alertas`);
    
    const alertListContainer = document.getElementById('alertListContainer');
    if (!alertListContainer) {
        console.error("No se encontró el contenedor de lista de alertas");
        return;
    }
    
    alertListContainer.innerHTML = '';
    
    alerts.forEach(alert => {
        try {
            const alertItem = document.createElement('div');
            alertItem.className = 'list-group-item';
            
            // Determine severity class
            let severityClass = 'text-info';
            let severityIcon = 'info-circle';
            
            if (alert.severity) {
                const severityLower = String(alert.severity).toLowerCase();
                switch (severityLower) {
                    case 'critical':
                        severityClass = 'text-danger';
                        severityIcon = 'exclamation-circle';
                        break;
                    case 'warning':
                        severityClass = 'text-warning';
                        severityIcon = 'exclamation-triangle';
                        break;
                }
            }
            
            // Format timestamp
            let timestamp = 'Desconocido';
            if (alert.timestamp) {
                try {
                    timestamp = new Date(alert.timestamp).toLocaleString();
                } catch (e) {
                    console.warn(`Error al formatear timestamp: ${e.message}`);
                }
            }
            
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
        } catch (error) {
            console.error("Error al renderizar alerta:", error);
        }
    });
}

// Reset machine details
function resetMachineDetails() {
    console.log("Reseteando detalles de máquina");
    
    // Reset alerts
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    const alertListContainer = document.getElementById('alertListContainer');
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');
    
    if (emptyAlertMessage) {
        emptyAlertMessage.textContent = 'Seleccione una máquina para ver sus alertas';
        emptyAlertMessage.classList.remove('d-none');
    }
    
    if (alertListContainer) {
        alertListContainer.innerHTML = '';
    }
    
    // Reset machine details
    if (machineDetailEmpty) {
        machineDetailEmpty.classList.remove('d-none');
    }
    
    if (machineDetailContent) {
        machineDetailContent.classList.add('d-none');
    }
}
